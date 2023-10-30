'use strict';

const {ethers} = require('ethers');
const rpc = require('../constants/rpc.js');
const tokens = require('../constants/tokens.js');

ethers.utils.Logger.setLogLevel('error');

class Web3Reader {
    #wallet;
    #tokenContract;
    #provider;

    constructor (chain, token, pk) {
        this.#provider = new ethers.providers.JsonRpcProvider(rpc[chain].url, rpc[chain].chain_id);
        this.#wallet = new ethers.Wallet(pk, this.#provider);
        this.#tokenContract = new ethers.Contract(tokens[chain][token].contract, tokens[chain][token].abi);
    }

    getTokenDecimals = async () => {
        return await this.#tokenContract.connect(this.#provider).decimals();
    }
    
    getTokenBalance = async () => {
        return await this.#tokenContract.connect(this.#provider).balanceOf(this.address);
    }
    
    getAllowanceAmount = async (spender) => {
        return await this.#tokenContract.connect(this.#provider).allowance(this.address, spender);
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
}

module.exports = Web3Reader;