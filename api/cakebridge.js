const {ethers} = require('ethers');
const rpc = require('../constants/rpc.js');
const tokens = require('../constants/tokens.js');
const cakeBridgeRouter = require('../constants/pancakeswap/cakebridge.js');
const utils = require('./utils');
const chain_id = require('../constants/chain_ids.js');

const fUnits = ethers.utils.formatUnits;

ethers.utils.Logger.setLogLevel('error');

class CakeBridge {
    #config;
    #chain;
    #provider;
    #wallet;
    #token;

    constructor (config, srcChain, pk) {
        this.#config = config;
        this.#chain = srcChain;
        this.#provider = new ethers.providers.JsonRpcProvider(rpc[srcChain].url, rpc[srcChain].chain_id);
        this.#wallet = new ethers.Wallet(pk, this.#provider);
        this.#token = 'CAKE';
    }

    approve = async (logger) => {
        const tokenContract = new ethers.Contract(tokens[this.#chain][this.#token].contract, tokens[this.#chain][this.#token].abi, this.#wallet);
        const {
            balance,
            decimals,
            allowance
        } = await utils.getTokenData(this.#chain, this.#token, this.#wallet.address, cakeBridgeRouter.contract);

        if (balance.eq(0)) {
            logger.warn(`Zero token balance`);
            return false;
        }

        if (allowance.gte(balance)) {
            logger.info(`Allowance ${fUnits(allowance, decimals)} ${this.#token}; balance ${fUnits(balance, decimals)} ${this.#token}`);
            return true;
        }

        logger.info(`Approve ${fUnits(balance, decimals)} ${this.#token} ...`);

        const nativeBalance = await this.#provider.getBalance(this.#wallet.address);
        const transactionParams = [cakeBridgeRouter.contract, balance];
        const {
            gasPrice,
            gasLimit,
            transactionCost,
        } = await utils.getTxData(this.#chain, tokenContract, 'approve', transactionParams, 0, logger);
        
        
        if (transactionCost.gt(nativeBalance)) {
            logger.warn(`Transaction cost greater than ${rpc[this.#chain].native} balance`);
            return false;
        }

        let receipt;
        do {
            try {
                const approveTx = await tokenContract.approve(...transactionParams, {
                    gasPrice,
                    gasLimit,
                });
                logger.info(`Approve transaction sent`);
                receipt = await Promise.race([approveTx.wait(), utils.timeoutLimit(this.#config.transaction_timeout_limit, logger)]);
                if (!receipt) {
                    logger.warn(`Time limit of ${this.#config.transaction_timeout_limit} sec has expired`);
                }
            } catch (error) {
                logger.warn(`Approve error with code [${error.code}]; reason: '${error.reason}'. Try again in 30 sec ...`);
                await utils.timeout(30);
                return await this.approve(logger);
            }
        } while (!receipt);

        if (receipt.status) {
            logger.info(`Approve transaction is confirmed`);
        } else { 
            logger.error(`Approve transaction ${receipt.transactionHash} is failed`);
        }

        return receipt.status;
    }

    bridge = async (dstChain, logger) => {
        const {
            balance,
            decimals,
        } = await utils.getTokenData(this.#chain, this.#token, this.#wallet.address);

        logger.info(`Transfer ${fUnits(balance, decimals)} ${this.#token} ...`);

        const cakeBridge = new ethers.Contract(cakeBridgeRouter.contract, cakeBridgeRouter.abi, this.#wallet);
        const lzFee = await this.#getLZFee(cakeBridge, dstChain, balance, logger);

        const transactionParams = [
            this.#wallet.address, // address _from,
            chain_id[dstChain], // uint16 _dstChainId,
            ethers.utils.hexZeroPad(this.#wallet.address, 32), // bytes32 _toAddress,
            balance, // uint256 _amount,
            0, // uint256 _minAmount,
            [
                this.#wallet.address,
                '0x0000000000000000000000000000000000000000',
                '0x00010000000000000000000000000000000000000000000000000000000000030d40'
            ], // tuple _callParams
        ];

        const {
            gasPrice,
            gasLimit,
            transactionCost
        } = await utils.getTxData(this.#chain, cakeBridge, 'sendFrom', transactionParams, lzFee, logger);
       
        const totalCosts = transactionCost.add(lzFee);
        const nativeBalance = await this.#provider.getBalance(this.#wallet.address);

        if (totalCosts.gt(nativeBalance)) {
            logger.warn(`Transaction cost greater than ${rpc[this.chain].native} balance`);
            return false;
        }

        let receipt;
        do {
            try {
                const bridgeTx = await cakeBridge.sendFrom(
                    ...transactionParams,
                    {
                        gasPrice,
                        gasLimit,
                        value: lzFee,
                    }
                );
                logger.info(`Bridge transaction sent`);
                receipt = await Promise.race([bridgeTx.wait(), utils.timeoutLimit(this.#config.transaction_timeout_limit, logger)]);
                if (!receipt) {
                    logger.warn(`Time limit of ${this.#config.transaction_timeout_limit} sec has expired`);
                }
            } catch (error) {
                logger.warn(`Bridge error with code [${error.code}]; reason: '${error.reason}'. Try again in 30 sec ...`);
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

    #getLZFee = async (contract, dstChain, amount, logger) => {
        try {
            const lzFee = (await contract.estimateSendFee(chain_id[dstChain], ethers.utils.hexZeroPad(this.#wallet.address, 32), amount, false, '0x00010000000000000000000000000000000000000000000000000000000000030d40')).nativeFee;
            return lzFee;
        } catch (error) {
            logger.error(`RPC returned an error for request contract function 'estimateSendFee'. Error reason '${error.reason}'. Try again after 60 seconds ...`)
            await utils.timeout(60);
            return await this.#getLZFee(contract, dstChain, amount, logger);
        }
    }
}

module.exports = CakeBridge;