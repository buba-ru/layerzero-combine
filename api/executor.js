'use strict';

const {ethers} = require('ethers');
const log4js = require('log4js');
const colots = require('colors');
const Okx = require('./okx/okx');
const utils = require('./utils');
const Stargate = require('./stargate');
const Merkly = require('./merkly');
const Pancakeswap = require('./puncakeswap');
const HarmonyBridge = require('./harmonybridge');
const TokenTransfer = require('./token_transfer');
const Holograph = require('./holograph');
const stgRouters = require('../constants/stargate/stargate.js');
const harmonyRouters = require('../constants/harmony/harmony.js');
const lzEndpoints = require('../constants/layerzero_endpoints.js');
const tokens = require(`../constants/tokens.js`);
const chain_id = require('../constants/chain_ids.js');
const rpc = require('../constants/rpc.js');
const withdraw_addr = require('../config/withdraw_okx.js');

const fUnits = ethers.utils.formatUnits;
const BN = ethers.BigNumber;
let logger;

class Executor {

    #pk;
    #address;
    #config;

    constructor (pk, config) {
        this.#pk = pk;
        this.#address = ethers.utils.computeAddress(pk);
        this.#config = config;

        logger = log4js.getLogger(this.#address);
        logger.level = 'debug';
    }

    perform = async (task) => {
        await this[task.action](task);
    }

    // {action: 'topup', chain: 'arbitrum', token: 'USDC', amount: '250:300'}
    topup = async (task) => {
        logger.info(`Top up of address by ${task.token} from Okx in ${task.chain} network`.bgBlue);

        const amount = {
            min: +task.amount.split(':')[0],
            max: +task.amount.split(':')[1]
        };
        
        const okx = new Okx(task.chain, task.token);
        let topUpResult;
        do {
            topUpResult = await okx.topUpAddress(this.#address, amount.min, amount.max);
            
            if (topUpResult.result) {
                logger.info(`Top up successful for ${topUpResult.data} ${task.token}`);
            } else {
                logger.warn(`Error when top up to the address: ${topUpResult.msg}. Try again in 60 sec ... `);
                await okx.fundAccumulation(logger);
                await utils.timeout(60);
            }
        } while (!topUpResult.result);
    }

    // {action: 'withdraw', chain: 'arbitrum', token: 'USDC'},
    withdraw = async (task) => {
        const transfer = new TokenTransfer(task.chain, task.token);
        const transferReceipt = await transfer.transfer(this.#pk, logger);

        if (transferReceipt.status) {
            logger.info(`Transfer confirmed`);
        } else {
            logger.warn(`Transfer failed`);
        }

        await utils.timeout(utils.getRandomInt(...this.#config.sleep_between_tasks), true);
    }

    // {action: 'withdraw_native', chain: 'fantom'},
    withdraw_native = async (task) => {
        const provider = new ethers.providers.JsonRpcProvider(rpc[task.chain].url, rpc[task.chain].chain_id);
        const wallet = new ethers.Wallet(this.#pk, provider);
        const toAddr = withdraw_addr[this.#address];
        const balance = await provider.getBalance(this.#address);
        const gasPrice = await provider.getGasPrice();
        const gasLimit = BN.from(utils.getRandomInt(23000, 40000))
        const value = balance.sub(gasLimit.mul(gasPrice));

        logger.info(`Withdraw ${fUnits(balance, 18)} native tokens from chain ${task.chain}`.bgBlue);
        
        const tx = await wallet.sendTransaction({
            to: toAddr,
            value: value,
            gasPrice: gasPrice,
            gasLimit: gasLimit
        });

        const receipt = await tx.wait();
        if (receipt.status) {
            logger.info(`Transfer confirmed`);
        } else {
            logger.warn(`Transfer failed`);
        }

        await utils.timeout(utils.getRandomInt(...this.#config.sleep_between_tasks), true);
    }
    
    // {action: 'wait_funds', chain: 'arbitrum', token: 'USDC'}
    wait_funds = async (task) => {
        let tokenData = await utils.getTokenData(task.chain, task.token, this.#address);
        
        if (tokenData.balance.eq(0)) {
            logger.info(`${task.chain}@${task.token} balance ${fUnits(tokenData.balance, tokenData.decimals)}`);
        }

        while (tokenData.balance.eq(0)) {
            logger.info(`${task.chain}@${task.token} Waiting for delivery of funds. Check again in 30 sec ...`);
            await utils.timeout(30);
            tokenData = await utils.getTokenData(task.chain, task.token, this.#address)
        }
        
        logger.info(`${task.chain}@${task.token} get ${fUnits(tokenData.balance, tokenData.decimals)}`);
    }

    // {action: 'stargate_bridge', route: 'arbitrum@USDC:polygon@USDC', dstGasForFee: 0.000025},
    stargate_bridge = async (task) => {
        const chain = {
            src: task.route.split(':')[0].split('@')[0],
            dst: task.route.split(':')[1].split('@')[0]
        }

        const token = {
            src: task.route.split(':')[0].split('@')[1],
            dst: task.route.split(':')[1].split('@')[1]
        }

        logger.info(`Stargate bridge ${chain.src}@${token.src} → ${chain.dst}@${token.dst}`.bgBlue);
        await utils.checkL1GasPrice(chain.src, chain.dst, this.#config, logger);

        const stargate = new Stargate(this.#config, chain.src, token.src, this.#pk);

        let approveResult;
        do {
            approveResult = await stargate.approve(logger);
            if (!approveResult) {
                if (!await utils.userConfirm()) {
                    process.exit(-1);
                }                   
            }
        } while (!approveResult);

        let transferResult;
        do {
            transferResult = await stargate.transfer(chain.dst, token.dst, task.dstGasForFee, logger);
            if (!transferResult) {
                if (!await utils.userConfirm()) {
                    process.exit(-1);
                } 
            }
        } while (!transferResult);

        await utils.timeout(utils.getRandomInt(...this.#config.sleep_between_tasks), true);
    }

    // {action: 'pancake_buy_token', chain: 'bsc', token: 'USDT', amount:'0.0005:0.0006'}
    pancake_buy_token = async (task) => {
        const amountRange = {
            min: +task.amount.split(':')[0],
            max: +task.amount.split(':')[1]
        };
        const amount = utils.getRandomDecimal(amountRange.min, amountRange.max, 18);

        logger.info(`Swap ${amount} ${rpc[task.chain].native} for ${task.token} in ${task.chain} network`.bgBlue);

        const pancakeswap = new Pancakeswap(this.#config, task.chain, this.#pk);
        
        let swapResult;
        do {
            swapResult = await pancakeswap.swap(task.token, amount, logger);
            if (!swapResult) {
                if (!await utils.userConfirm()) {
                    process.exit(-1);
                } 
            }
        } while (!swapResult);

        await utils.timeout(utils.getRandomInt(...this.#config.sleep_between_tasks), true);
    }

    // {action: 'harmony_bridge', chain: 'bsc:harmony', token: 'BUSD'},
    harmony_bridge = async (task) => {
        const chain = {
            src: task.chain.split(':')[0],
            dst: task.chain.split(':')[1],
        }

        logger.info(`Harmony bridge. From ${chain.src} to ${chain.dst}. Token: ${task.token}`.bgBlue);
        const harmonyBridge = new HarmonyBridge(this.#config, chain.src, task.token, this.#pk);

        let approveResult;
        do {
            approveResult = await harmonyBridge.approve(logger);
            if (!approveResult) {
                if (!await utils.userConfirm()) {
                    process.exit(-1);
                }
            }
        } while (!approveResult);

        let bridgeResult;
        do {
            bridgeResult = await harmonyBridge.bridge(chain.dst, logger);
            if (!bridgeResult) {
                if (!await utils.userConfirm()) {
                    process.exit(-1);
                }
            }
        } while (!bridgeResult);
        
        await utils.timeout(utils.getRandomInt(...this.#config.sleep_between_tasks), true);
    }

    // {action: 'merkly_oft_mint', chain: 'polygon', amount: 5}
    merkly_oft_mint = async (task) => {
        logger.info(`[${task.chain}] Mint ${task.amount} MERK ...`.bgBlue);
        await utils.checkL1GasPrice(task.chain, null, this.#config, logger);

        const merkly = new Merkly(this.#config, task.chain, this.#pk);

        let mintResult;
        do {
            mintResult = await merkly.mint(task.amount, logger);
            if (!mintResult) {
                if (!await utils.userConfirm()) {
                    process.exit(-1);
                }                   
            }
        } while (!mintResult);

        await utils.timeout(utils.getRandomInt(...this.#config.sleep_between_tasks), true);
    }

    // {action: 'merkly_oft_bridge', chain: 'polygon:zora'}
    merkly_oft_bridge = async (task) => {
        const chain = {
            src: task.chain.split(':')[0],
            dst: task.chain.split(':')[1],
        }

        logger.info(`[${chain.src} → ${chain.dst}] Bridge 1 MERK ...`.bgBlue);
        await utils.checkL1GasPrice(chain.src, chain.dst, this.#config, logger);

        const merkly = new Merkly(this.#config, chain.src, this.#pk);

        let bridgeResult;
        do {
            bridgeResult = await merkly.bridge(chain.dst, logger);
            if (!bridgeResult) {
                if (!await utils.userConfirm()) {
                    process.exit(-1);
                }                   
            }
        } while (!bridgeResult);

        await utils.timeout(utils.getRandomInt(...this.#config.sleep_between_tasks), true);
    }

    // {action: 'holograph_mint', chain: 'polygon', contract: '0x2c4bd4e25d83285f417e26a44069f41d1a8ad0e7', quantity: 1}
    holograph_mint = async (task) => {
        logger.info(`[${task.chain}] Mint ${task.quantity} Holograph NFT`.bgBlue);
        await utils.checkL1GasPrice(task.chain, null, this.#config, logger);

        const holograph = new Holograph(this.#config, task.chain, this.#pk);

        let mintResult;
        do {
            mintResult = await holograph.mint(task.contract, task.quantity, logger);
            if (!mintResult) {
                if (!await utils.userConfirm()) {
                    process.exit(-1);
                }                   
            }
        } while (!mintResult);

        await utils.timeout(utils.getRandomInt(...this.#config.sleep_between_tasks), true);
        
    }

    // {action: 'holograph_bridge', chain: 'polygon:avalanche', contract: '0x2c4bd4e25d83285f417e26a44069f41d1a8ad0e7'}
    holograph_bridge = async (task) => {
        const chain = {
            src: task.chain.split(':')[0],
            dst: task.chain.split(':')[1],
        }

        logger.info(`[${chain.src} → ${chain.dst}] Bridge Holograph NFT`.bgBlue);
        await utils.checkL1GasPrice(task.chain, null, this.#config, logger);

        const holograph = new Holograph(this.#config, chain.src, this.#pk);

        let bridgeResult;
        do {
            bridgeResult = await holograph.bridge(chain.dst, task.contract, logger);
            if (!bridgeResult) {
                if (!await utils.userConfirm()) {
                    process.exit(-1);
                }                   
            }
        } while (!bridgeResult);

        await utils.timeout(utils.getRandomInt(...this.#config.sleep_between_tasks), true);
    }
}

module.exports = Executor;