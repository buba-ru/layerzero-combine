'use strict';

const {ethers} = require('ethers');
const rpc = require('../constants/rpc.js');
const mintABI = require('../constants/holograph/holograph_mint_abi.js');

const BN = ethers.BigNumber;

ethers.utils.Logger.setLogLevel('error');

class Holograph {
    #provider;
    #wallet;
    #web3reader;
    #tx;
    #attempts;

    constructor (chain, contract, pk) {
        this.#provider = new ethers.providers.JsonRpcProvider(rpc[chain].url, rpc[chain].chain_id);
        this.#wallet = new ethers.Wallet(pk, this.#provider);
        this.#attempts = 2;

        this.chain = chain;
        this.contract = contract;
        this.abi = mintABI;
    }
    
    mint = async () => {

        
        const feeData = await this.#provider.getFeeData();
        const balance = await this.#provider.getBalance(this.#wallet.address);
        const estimatedSpend = feeData.gasPrice.mul(BN.from('381822'));
        if (estimatedSpend.gt(balance)) {
            console.log(`${this.#wallet.address} > Estimated spend ${ethers.utils.formatUnits(estimatedSpend, 18)} > balance ${ethers.utils.formatUnits(balance, 18)}`.red);
            console.log(`${this.#wallet.address} > Try again in 1 minute ...`);
            await new Promise(resolve => setTimeout(resolve, 60 * 1000));
            return await this.mint();
        }
        const contract = new ethers.Contract(this.contract, this.abi);
        try {  
            this.#tx = await contract.connect(this.#wallet).purchase(1,
                {
                    value: BN.from('187678141980308456'),
                    gasPrice: feeData.gasPrice,
                    gasLimit: BN.from('381800'),
                }
            );
            console.log(`Send transaction with hash: ${this.#tx.hash}`);
        } catch (error) {
            console.log(`${this.#wallet.address} > Transfer error with code [${error.code}]; reason: '${error.reason}'`.red);
            if (this.#attempts > 1) {
                this.#attempts--;
                console.log(`${this.#wallet.address} > Try again ...`);
                await new Promise(resolve => setTimeout(resolve, 2 * 1000));
                return await this.mint();
            }
        }
        
    }
}

module.exports = Holograph;