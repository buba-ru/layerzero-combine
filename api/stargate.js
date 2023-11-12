'use strict';

const {ethers} = require('ethers');
const rpc = require('../constants/rpc.js');
const tokens = require('../constants/tokens.js');
const stgRouters = require('../constants/stargate/stargate.js');
const utils = require('./utils');
const chain_id = require('../constants/chain_ids.js');
const pool_id = require('../constants/stargate/pool_ids.js');

const fUnits = ethers.utils.formatUnits;
const BN = ethers.BigNumber;

ethers.utils.Logger.setLogLevel('error');

class Stargate {
    #config;
    #srcChain;
    #srcToken;
    #provider;
    #wallet;


    constructor (config, chain, token, pk) {
        this.#config = config;
        this.#srcChain = chain;
        this.#srcToken = token;
        this.#provider = new ethers.providers.JsonRpcProvider(rpc[chain].url, rpc[chain].chain_id);
        this.#wallet = new ethers.Wallet(pk, this.#provider);
    }

    approve = async (logger) => {
        const tokenContract = new ethers.Contract(tokens[this.#srcChain][this.#srcToken].contract, tokens[this.#srcChain][this.#srcToken].abi, this.#wallet);
        const {
            balance,
            decimals,
            allowance
        } = await utils.getTokenData(this.#srcChain, this.#srcToken, this.#wallet.address, stgRouters[this.#srcChain].contract);

        if (balance.eq(0)) {
            logger.warn(`Zero token balance`);
            return false;
        }

        if (allowance.gte(balance)) {
            logger.info(`Allowance ${fUnits(allowance, decimals)} ${this.#srcToken}; balance ${fUnits(balance, decimals)} ${this.#srcToken}`);
            return true;
        }

        logger.info(`Approve ${fUnits(balance, decimals)} ${this.#srcToken} ...`);

        const nativeBalance = await this.#provider.getBalance(this.#wallet.address);
        const transactionParams = [stgRouters[this.#srcChain].contract, balance];
        const {
            gasPrice,
            gasLimit,
            transactionCost
        } = await utils.getTxData(this.#srcChain, tokenContract, 'approve', transactionParams, 0, logger);

        if (transactionCost.gt(nativeBalance)) {
            logger.warn(`Transaction cost greater than ${rpc[this.#srcChain].native} balance`);
            return false;
        }

        let approveReciept;
        do {
            try {
                const tx = await tokenContract.approve(...transactionParams, {
                        gasPrice: gasPrice,
                        gasLimit: gasLimit,
                    });
                logger.info(`Approve transaction sent`);
                approveReciept = await Promise.race([tx.wait(), utils.timeoutLimit(this.#config.transaction_timeout_limit, logger)]);

                if (!approveReciept) {
                    logger.warn(`Time limit of ${this.#config.transaction_timeout_limit} sec has expired`);
                }
            } catch (error) {
                logger.warn(`Approve error with code [${error.code}]; reason: '${error.reason}'. Try again in 30 sec ...`);
                await utils.timeout(30);
                return await this.approve(logger);
            }
        } while (!approveReciept);

        if (approveReciept.status) {
            logger.info(`Approve transaction is confirmed`);
        } else { 
            logger.error(`Approve transaction ${approveReciept.transactionHash} is failed`);
        }

        return approveReciept.status;
    }
    
    transfer = async (dstChain, dstToken, dstGasForFee, logger) => {
        const {balance: amount} = await utils.getTokenData(this.#srcChain, this.#srcToken, this.#wallet.address);

        // Calc minAmountLD (amount - slippage)
        const slippageFN = ethers.FixedNumber.fromString(this.#config.stargate_slippage);
        const amountFN = ethers.FixedNumber.from(amount)
        const minAmountLD = BN.from(amountFN.subUnsafe(amountFN.mulUnsafe(slippageFN.mulUnsafe(ethers.FixedNumber.fromString('0.01')))).toString().split('.')[0]);
        
        const stargate = new ethers.Contract(stgRouters[this.#srcChain].contract, stgRouters[this.#srcChain].abi, this.#wallet);

        let lzTxParams = [0, 0, '0x0000000000000000000000000000000000000001'];
        if (dstGasForFee > 0) {
            dstGasForFee = ethers.utils.parseUnits(utils.getRandomDecimal(dstGasForFee, dstGasForFee * 1.02, 18).toString(), 18);
            lzTxParams = [0, dstGasForFee, this.#wallet.address,];
        }

        const transactionParams = [
            chain_id[dstChain],
            pool_id[this.#srcChain][this.#srcToken],
            pool_id[dstChain][dstToken],
            this.#wallet.address,
            amount,
            minAmountLD,
            lzTxParams,
            this.#wallet.address,
            '0x',
        ];

        const lzFee = (await stargate.quoteLayerZeroFee(chain_id[dstChain], 1, this.#wallet.address, '0x', lzTxParams))[0];

        const {
            gasPrice,
            gasLimit,
            transactionCost
        } = await utils.getTxData(this.#srcChain, stargate, 'swap', transactionParams, lzFee, logger);

        const nativeBalance = await this.#provider.getBalance(this.#wallet.address);
        const totalCosts = transactionCost.add(lzFee);

        if (totalCosts.gt(nativeBalance)) {
            logger.warn(`Estimated costs ${fUnits(totalCosts, 18)}  greater than balance ${fUnits(nativeBalance, 18)} ${rpc[this.#srcChain].native}. Try again in 60 sec ...`);
            await utils.timeout(60);
            return await this.transfer(dstChain, dstToken, dstGasForFee, logger);
        }
        
        let transferReceipt;
        do {
            try {
                const tx = await stargate.swap(...transactionParams, {
                        gasPrice: gasPrice,
                        gasLimit: gasLimit,
                        value: lzFee
                    });
                logger.info(`Transfer transaction sent`);
                transferReceipt = await Promise.race([tx.wait(), utils.timeoutLimit(this.#config.transaction_timeout_limit, logger)]);
                
                if (!transferReceipt) {
                    logger.warn(`Time limit of ${this.#config.transaction_timeout_limit} sec has expired`);
                }
            } catch (error) {
                logger.warn(`Transfer error with code [${error.code}]; reason: '${error.reason}'. Try again in 30 sec ...`);
                await utils.timeout(30);
                return await this.transfer(dstChain, dstToken, dstGasForFee, logger);
            }
        } while (!transferReceipt);
        
        if (transferReceipt.status) {
            logger.info(`Transfer transaction is confirmed`);
        } else {
            logger.error(`Transfer transaction ${transferReceipt.transactionHash} is failed`);
        }

        return transferReceipt.status;
    }
}

module.exports = Stargate;