'use strict';

const {ethers} = require('ethers');
const rpc = require('../constants/rpc.js');
const tokens = require('../constants/tokens.js');
const pancakeswapRouters = require('../constants/pancakeswap/pancakeswap.js');
const utils = require('./utils');

const fUnits = ethers.utils.formatUnits;

ethers.utils.Logger.setLogLevel('error');

class Pancakeswap {
    #config;
    #chain;
    #provider;
    #wallet;
    #tx;

    constructor (config, chain, pk) {
        this.#config = config;
        this.#chain = chain;
        this.#provider = new ethers.providers.JsonRpcProvider(rpc[chain].url, rpc[chain].chain_id);
        this.#wallet = new ethers.Wallet(pk, this.#provider);
    }

    swap = async (token, amount, logger) => {
        amount = ethers.utils.parseUnits(amount.toString(), 18);
        const pancakeRouter = new ethers.Contract(pancakeswapRouters[this.#chain].contract, pancakeswapRouters[this.#chain].abi, this.#wallet);
        const transactionParams = [
            0,
            ['0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', tokens[this.#chain][token].contract],
            this.#wallet.address,
            Math.floor(Date.now() / 1000) + 10000,
        ];

        
        const {
            gasPrice,
            gasLimit,
            transactionCost
        } = await utils.getTxData(this.#chain, pancakeRouter, 'swapExactETHForTokens', transactionParams, amount, logger);
        
        const estimatedSpend =  amount.add(transactionCost);
        const nativeBalance = await this.#provider.getBalance(this.#wallet.address);

        if (estimatedSpend.gt(nativeBalance)) {
            logger.warn(`Estimated spend exceed the balance (${fUnits(estimatedSpend, 18)} ${rpc[this.#chain].native} > balance ${fUnits(nativeBalance, 18)} ${rpc[this.#chain].native}). Try again in 60 sec ...`);
            await utils.timeout(60);
            return await this.swap(token, amount, logger);
        }

        let receipt;
        do {
            try {
                const tx = await pancakeRouter.swapExactETHForTokens(
                    ...transactionParams,
                    {
                        gasPrice,
                        gasLimit,
                        value: amount,
                    }
                );
                logger.info(`Swap transaction sent`);
                receipt = await Promise.race([tx.wait(), utils.timeoutLimit(this.#config.transaction_timeout_limit, logger)]);

                if (!receipt) {
                    logger.warn(`Time limit of ${this.#config.transaction_timeout_limit} sec has expired`);
                }
            } catch (error) {
                logger.warn(`Swap error with code [${error.code}]; reason: '${error.reason}'. Try again in 30 sec ...`);
                await utils.timeout(30);
                return await this.swap(token, amount, logger);
            }
        } while (!receipt);

        if (receipt.status) {
            logger.info(`Swap transaction is confirmed`);
        } else {
            logger.error(`Swap transaction ${receipt.transactionHash} is failed`);
        }

        return receipt.status;
    }
}

module.exports = Pancakeswap;