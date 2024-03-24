'use strict';

const {ethers} = require('ethers');

const destAddr = require('../config/withdraw_okx.js');
const rpc = require('../constants/rpc.js');
const tokens = require('../constants/tokens.js');
const utils = require('./utils');

ethers.utils.Logger.setLogLevel('error');

class TokenTransfer {
    constructor (chain, token) {
        this.chain = chain;
        this.token = token;
    }

    transfer = async (privateKey, logger) => {
        const address = ethers.utils.computeAddress(privateKey);;
        const okx_addr = destAddr[address];
        
        const provider = new ethers.providers.JsonRpcProvider(rpc[this.chain].url, rpc[this.chain].chain_id);
        const wallet = new ethers.Wallet(privateKey, provider);
        const tokenData = await utils.getTokenData(this.chain, this.token, address)
        const decimals = tokenData.decimals;
        const amount = tokenData.balance;
        
        logger.info(`Transfer ${ethers.utils.formatUnits(amount, decimals)} ${this.token} ${address.substring(address.length - 5)} → ${okx_addr.substring(okx_addr.length - 5)} ...`.bgBlue);
        
        const balance = await provider.getBalance(address);
        const tokenContract = new ethers.Contract(tokens[this.chain][this.token].contract, tokens[this.chain][this.token].abi, wallet);

        const {
            gasPrice,
            gasLimit,
            transactionCost
        } = await utils.getTxData(this.chain, tokenContract, 'transfer', [okx_addr, amount], 0, logger);

        if (transactionCost.gt(balance)) {
            logger.warn(`Estimated spend ${ethers.utils.formatUnits(estimatedSpend, 18)} > balance ${ethers.utils.formatUnits(balance, 18)}. Try again in 60 sec ...`);
            await utils.timeout(60);
            return await this.transfer(privateKey, logger);
        }

        const tx = await tokenContract.transfer(okx_addr, amount, {
            gasPrice,
            gasLimit,
        });
        const receipt = await tx.wait();

        return receipt;
    }
}

module.exports = TokenTransfer;