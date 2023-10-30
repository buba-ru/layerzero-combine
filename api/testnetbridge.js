'use strict';

const {ethers} = require('ethers');
const rpc = require('../constants/rpc.js');
const zroEndpoints = require('../constants/layerzero_endpoints.js');
const goerliRouters = require('../constants/testnetbridge.js');
const chain_id = require('../constants/chain_ids.js');

const BN = ethers.BigNumber;

ethers.utils.Logger.setLogLevel('error');

class Testnetbridge {
    #provider;
    #wallet;
    #web3reader;
    #tx;

    constructor (chain, pk) {
        this.#provider = new ethers.providers.JsonRpcProvider(rpc[chain].url, rpc[chain].chain_id);
        this.#wallet = new ethers.Wallet(pk, this.#provider);

        this.chain = chain;
    }
    
    transfer = async (dstChain, amount) => {
        const gasPrice = await this.#provider.getGasPrice();
        const balance = await this.#provider.getBalance(this.#wallet.address);
    
        // get L0 protocol fee
        const layerzero = new ethers.Contract(zroEndpoints[this.chain].contract, zroEndpoints[this.chain].abi);
        const zroFee = await layerzero.connect(this.#wallet).estimateFees(chain_id[dstChain], this.#wallet.address, '0x', false, '0x');
        const nativeFee = zroFee.nativeFee.add(zroFee.nativeFee.div(BN.from('99'))); //original value increased by 1%

        const estimatedSpend = amount.add(nativeFee.add(gasPrice.mul(goerliRouters[this.chain].gas_limit)));
        if (estimatedSpend.gt(balance)) {
            console.log(`${this.#wallet.address} > Estimated spend ${ethers.utils.formatUnits(estimatedSpend, 18)} > balance ${ethers.utils.formatUnits(balance, 18)}`.red);
            console.log(`${this.#wallet.address} > Try again in 1 minute ...`);
            await new Promise(resolve => setTimeout(resolve, 60 * 1000));
            return await this.transfer(dstChain, amount);
        }
        
        const testnetbridge = new ethers.Contract(goerliRouters[this.chain].contract, goerliRouters[this.chain].abi);
        try {
            const value = amount.add(nativeFee);
            this.#tx = await testnetbridge.connect(this.#wallet).swapAndBridge(
                amount,
                0,
                chain_id[dstChain],
                this.#wallet.address,
                this.#wallet.address,
                '0x0000000000000000000000000000000000000000',
                '0x',
                {
                    gasPrice: gasPrice,
                    gasLimit: goerliRouters[this.chain].gas_limit,
                    value: value
                }
            );
        } catch (error) {
            console.log(`${this.#wallet.address} > Transfer error with code [${error.code}]; reason: '${error.reason}'`.red);
            console.log(`${this.#wallet.address} > Try again ...`);
            await new Promise(resolve => setTimeout(resolve, 10 * 1000));
            return await this.transfer(dstChain, amount);
        }

        return await this.#tx.wait();
    }
}

module.exports = Testnetbridge;