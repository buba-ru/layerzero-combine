'use strict';

const fs = require('fs');
const {ethers} = require('ethers');
const prompts = require('prompts');
const rpc = require('../constants/rpc.js');
const tokens = require('../constants/tokens.js');
const config = require('../config/config');


const fUnits = ethers.utils.formatUnits;

class Utils {
    static getRandomInt = (min, max) => {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1) + min);
    }

    static getRandomDecimal = (min, max, precision) => {
        let amount = Math.random() * (max - min) + min;
        return +amount.toFixed(precision);
    }

    static timeout = (sec, show = false) => {
        if (show) {
            console.log(`Delay ${sec} sec ...`);
        }
        return new Promise(res => setTimeout(res, sec * 1000));
    }

    static timeoutLimit = (sec) => {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                resolve(false);
            }, sec * 1000);
        });
    }

    static fileToArr = (path) => {
        let lines = fs.readFileSync(path).toString('UTF8').split('\n');
        lines = lines.map(pk => pk.trim());
        return lines.filter(pk => pk != '');
    }

    // get time string
    static ts = () => {
		return new Date().toLocaleString('ru', {
			hour12: false,
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

    static checkL1GasPrice = async (srcChain, dstChain, config, logger) => {
        const gasPriceCap = ethers.utils.parseUnits(config.L1_gasprice_cap.toString(), 'gwei');
        if (config.L1_dependent_networks.includes(srcChain) || config.L1_dependent_networks.includes(dstChain))  {
            const L1Provider = new ethers.providers.JsonRpcProvider(rpc.ethereum.url, rpc.ethereum.chain_id);
            let L1GasPrice = await L1Provider.getGasPrice();
            while (L1GasPrice.gt(gasPriceCap)) {
                logger.warn(`L1 gas price: ${fUnits(L1GasPrice, 'gwei')} > ${fUnits(gasPriceCap, 'gwei')}. Check again in 60 sec ...`);
                await Utils.timeout(60);
                L1GasPrice = await L1Provider.getGasPrice();
            }

            logger.info(`L1 gas price: ${fUnits(L1GasPrice, 'gwei')}`);
        }
	}

    static getTokenData = async (chain, token, address, spender = null) => {
        const ptovider = new ethers.providers.JsonRpcProvider(rpc[chain].url, rpc[chain].chain_id);
        const tokenContract = new ethers.Contract(tokens[chain][token].contract, tokens[chain][token].abi);
        const tokenData = {};
        tokenData.decimals = await tokenContract.connect(ptovider).decimals();
        tokenData.balance = await tokenContract.connect(ptovider).balanceOf(address);

        if (spender != null) {
            tokenData.allowance = await tokenContract.connect(ptovider).allowance(address, spender);
        }

        return tokenData;
    }

    static userConfirm = async () => {
        const response = await prompts({
            type: 'confirm',
            name: 'value',
            message: 'Try again?',
            initial: true
        });
    
        return response.value;
    }

    static getTxData = async (chain, tokenContract, method, transactionParams, value, logger) => {
        const provider = new ethers.providers.JsonRpcProvider(rpc[chain].url, rpc[chain].chain_id);
        let gasPrice;
        if (chain == 'base') {
            gasPrice = (await provider.getFeeData()).lastBaseFeePerGas.mul(2);
        }

        if (chain in config.custom_gas_price) {
            gasPrice = ethers.utils.parseUnits(config.custom_gas_price[chain], 'gwei');
        } else {
            gasPrice = await provider.getGasPrice();
        }

        let gasLimit;
        try {
            gasLimit = (await tokenContract.estimateGas[method](...transactionParams, {gasPrice: gasPrice, value: value})).div(100).mul(110); // gasLimit + 10%
        } catch (error) {
            logger.warn(`getTransactionCost error with code [${error.code}]; reason: '${error.reason}'. Try again in 10 sec...`);
            await this.timeout(10);
            return await this.getTxData(chain, tokenContract, method, transactionParams, value, logger);
        }

        const transactionCost = gasPrice.mul(gasLimit);
        return {gasPrice, gasLimit, transactionCost};
    }
}

module.exports = Utils;