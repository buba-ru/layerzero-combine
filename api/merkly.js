'use strict';

const {ethers} = require('ethers');
const rpc = require('../constants/rpc.js');
const tokens = require('../constants/tokens.js');
const utils = require('./utils');
const chain_id = require('../constants/chain_ids.js');

const fUnits = ethers.utils.formatUnits;
const BN = ethers.BigNumber;

ethers.utils.Logger.setLogLevel('error');

class Merkly {
    #config;
    #chain;
    #provider;
    #wallet;
    #merkly;

    constructor (config, chain, pk) {
        this.#config = config;
        this.#provider = new ethers.providers.JsonRpcProvider(rpc[chain].url, rpc[chain].chain_id);
        this.#wallet = new ethers.Wallet(pk, this.#provider);
        this.#merkly = new ethers.Contract(tokens[chain].MERK.contract, tokens[chain].MERK.abi, this.#wallet);
        this.#chain = chain;
    }

    mint = async (amount, logger) => {
        const mintPrice = ethers.utils.parseUnits(tokens[this.#chain].MERK.mint_price, 18);
        
        const transactionParams = [
            this.#wallet.address,   // _to
            amount,                 // 	_amount
        ];
        
        const value = mintPrice.mul(amount);
        
        const {
            gasPrice,
            gasLimit,
            transactionCost
        } = await utils.getTxData(this.#chain, this.#merkly, 'mint', transactionParams, value, logger);

        let receipt;
        do {
            try {
                const tx = await this.#merkly.mint(...transactionParams, {
                        gasPrice,
                        gasLimit,
                        value,
                    });
                logger.info(`Mint transaction sent`);
                receipt = await Promise.race([tx.wait(), utils.timeoutLimit(this.#config.transaction_timeout_limit, logger)]);
                
                if (!receipt) {
                    logger.warn(`Time limit of ${this.#config.transaction_timeout_limit} sec has expired`);
                }
            } catch (error) {
                logger.warn(`Mint error with code [${error.code}]; reason: '${error.reason}'. Try again after 10 seconds ...`);
                await utils.timeout(10);
                return await this.mint(amount, logger);
            }
        } while (!receipt);

        if (receipt.status) {
            logger.info(`Mint transaction is confirmed`);
        } else { 
            logger.error(`Mint transaction ${receipt.transactionHash} is failed`);
        }

        return receipt.status;
    }

    bridge = async (dstChain, logger) => {
        // Проверить наличие MERK на адресе. Если MERK нет, ждем поступления
        let { balance } = await utils.getTokenData(this.#chain, 'MERK', this.#wallet.address);
        while (balance.lt(1)) {
            logger.warn(`Not enough MARK on the balance. Check again in 30 sec ...`);
            await utils.timeout(30);
            return await this.bridge(dstChain, logger);
        }
        
        // Параметры транзакции
        const transactionParams = [
            this.#wallet.address,   // _from
            chain_id[dstChain],     // _dstChainId
            this.#wallet.address,   // _toAddress
            '1000000000000000000',  // _amount
            this.#wallet.address,   // _refundAddress
            '0x0000000000000000000000000000000000000000', // _zroPaymentAddress
            '0x', // _adapterParams
        ];

        // Посчитать предполагаемые расходы
        let lzFee;
        try {
            lzFee = (await this.#merkly.estimateSendFee(chain_id[dstChain], this.#wallet.address, 1, false, '0x')).nativeFee;
        } catch (error) {
            logger.error(`RPC returned an error for request contract function 'estimateSendFee'. Error reason '${error.reason}'. Try again after 60 seconds ...`)
            await utils.timeout(60);
            return await this.bridge(dstChain, logger);
        }

        const {
            gasPrice,
            gasLimit,
            transactionCost
        } = await utils.getTxData(this.#chain, this.#merkly, 'sendFrom', transactionParams, lzFee, logger)
        
        const totalCosts = transactionCost.add(lzFee);
        const nativeBalance = await this.#provider.getBalance(this.#wallet.address);
        
        if (totalCosts.gt(nativeBalance)) {
            logger.warn(`Estimated costs ${fUnits(totalCosts, 18)}  greater than balance ${fUnits(nativeBalance, 18)} ${rpc[this.#chain].native}. Try again in 60 sec ...`);
            await utils.timeout(60);
            return await this.bridge(dstChain, logger);
        }

        let receipt;
        do {
            try {
                const tx = await this.#merkly.sendFrom(...transactionParams, {
                        gasPrice,
                        gasLimit,
                        value: lzFee,
                    });
                logger.info(`Bridge transaction sent`);
                receipt = await Promise.race([tx.wait(), utils.timeoutLimit(this.#config.transaction_timeout_limit, logger)]);
                
                if (!receipt) {
                    logger.warn(`Time limit of ${this.#config.transaction_timeout_limit} sec has expired`);
                }
            } catch (error) {
                logger.warn(`Bridge error with code [${error.code}]; reason: '${error.reason}'. Try again after 30 seconds ...`);
                await utils.timeout(30);
                return await this.bridge(dstChain, logger);
            }
        } while (!receipt);

        if (receipt.status) {
            logger.info(`Bridge transaction is confirmed`);
        } else {
            logger.error(`Bridge transaction ${receipt.transactionHash} is failed`);
        }

        return receipt.status;
    }
}

module.exports = Merkly;