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
    #provider;
    #wallet;
    #merkly;
    #tx;

    constructor (chain, pk) {
        this.#provider = new ethers.providers.JsonRpcProvider(rpc[chain].url, rpc[chain].chain_id);
        this.#wallet = new ethers.Wallet(pk, this.#provider);
        this.#merkly = new ethers.Contract(tokens[chain].MERK.contract, tokens[chain].MERK.abi, this.#wallet);

        this.chain = chain;
        this.token = 'MERK';
    }

    mint = async (amount, logger) => {
        const mintPrice = ethers.utils.parseUnits(tokens[this.chain].MERK.mint_price, 18);

        let receipt;
        do {
            try {
                const gasLimit = await this.#merkly.estimateGas.mint(this.#wallet.address, amount, {value: mintPrice.mul(amount)});
                this.#tx = await this.#merkly.mint(
                    this.#wallet.address,   // _to
                    amount,                 // 	_amount
                    {
                        gasPrice: await this.#provider.getGasPrice(),
                        gasLimit: gasLimit,
                        value: mintPrice.mul(amount),
                    }
                );

            } catch (error) {
                logger.warn(`Mint error with code [${error.code}]; reason: '${error.reason}'. Try again after 10 seconds ...`);
                await utils.timeout(10);
                return await this.mint(amount, logger);
            }

            receipt = await Promise.race([this.#tx.wait(), utils.timeoutLimit(120, logger)]);
            if (!receipt) {
                logger.warn(`Time limit of 120 sec has expired`);
            }
        } while (!receipt);

        return receipt;
    }

    bridge = async (dstChain, logger) => {
        // Проверить наличие MERK на адресе. Если MERK нет, ждем поступления
        let tokenData = await utils.getTokenData(this.chain, 'MERK', this.#wallet.address);
        while (tokenData.balance.lt(1)) {
            logger.warn(`Not enough MARK on the balance. Check again in 30 sec ...`);
            await utils.timeout(30);
            tokenData = await utils.getTokenData(this.chain, 'MERK', this.#wallet.address)
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
        const gasPrice = await this.#provider.getGasPrice();

        let zroFee;
        try {
            zroFee = await this.#merkly.estimateSendFee(chain_id[dstChain], this.#wallet.address, 1, false, '0x');
        } catch (error) {
            logger.error(`RPC returned an error for request contract function 'estimateSendFee'. Error reason '${error.reason}'. Try again after 60 seconds ...`)
            await utils.timeout(60);
            return await this.bridge(dstChain, logger);
        }
        
        let gasLimit;
        try {
            gasLimit = await this.#merkly.estimateGas.sendFrom(...transactionParams, {gasPrice: gasPrice, value: zroFee.nativeFee});
        } catch (error) {
            logger.error(`RPC returned an error for request estimate gas. Error reason '${error.reason}'. Try again after 60 seconds ...`)
            await utils.timeout(60);
            return await this.bridge(dstChain, logger);
        }

        const estimatedSpend =  zroFee.nativeFee.add(gasPrice.mul(BN.from(gasLimit.toString())));
        
        // Получить нативный баланс
        const nativeBalance = await this.#provider.getBalance(this.#wallet.address);
        
        if (nativeBalance.gt(estimatedSpend)) {
            let receipt;
            do {
                try {
                    this.#tx = await this.#merkly.sendFrom(
                        ...transactionParams,
                        {
                            gasPrice: gasPrice,
                            gasLimit: gasLimit,
                            value: zroFee.nativeFee,
                        }
                    );
                } catch (error) {
                    logger.warn(`Bridge error with code [${error.code}]; reason: '${error.reason}'. Try again after 30 seconds ...`);
                    await utils.timeout(30);
                    return await this.bridge(dstChain, logger);
                }
                receipt = await Promise.race([this.#tx.wait(), utils.timeoutLimit(120, logger)]);
                if (!receipt) {
                    logger.warn(`Time limit of 120 sec has expired`);
                }
            } while (!receipt);

            return receipt;
        } else {
            logger.warn(`Estimated spend exceed the balance (${fUnits(estimatedSpend, 18)} > balance ${fUnits(nativeBalance, 18)}). Transfer minimum ${fUnits(estimatedSpend.sub(nativeBalance), 18)} ${rpc[this.chain].native} to current address. Try again in 60 sec ...`);
            await utils.timeout(60);
            return await this.bridge(dstChain, logger);
        }
    }
}

module.exports = Merkly;