'use strict';

const {ethers} = require('ethers');
const {NftscanEvm} = require('nftscan-api');
const rpc = require('../constants/rpc.js');
const hlgChainId = require('../constants/holograph/chain_ids.js');
const utils = require('./utils');

const fUnits = ethers.utils.formatUnits;
const BN = ethers.BigNumber;
const abiCoder = new ethers.utils.AbiCoder();

ethers.utils.Logger.setLogLevel('error');

class Holograph {
    #config;
    #provider;
    #wallet;
    #chain;

    constructor (config, chain, pk) {
        this.#config = config;
        this.#provider = new ethers.providers.JsonRpcProvider(rpc[chain].url, rpc[chain].chain_id);
        this.#wallet = new ethers.Wallet(pk, this.#provider);
        this.#chain = chain;
    }
    
    mint = async (contract, quantity, logger) => {
        const nftContract = new ethers.Contract(contract,
            [
                'function purchase(uint256) payable',
                'function getHolograph() view returns (address)',
                'function getSourceContract() view returns (address)',
                
            ],
            this.#wallet);
        const holographAddr = await nftContract.getHolograph();
        const srcContractAddr = await nftContract.getSourceContract();

        const holographContract = new ethers.Contract(holographAddr,
            ['function getTreasury() view returns (address)'],
            this.#provider);
        const holographTreasuryProxy = await holographContract.getTreasury();

        const holographTreasuryProxyContract = new ethers.Contract(holographTreasuryProxy,
            ['function getTreasury() view returns (address)'],
            this.#provider);
        const holographTreasury = await holographTreasuryProxyContract.getTreasury();

        const holographTreasuryContract = new ethers.Contract(holographTreasury,
            ['function getHolographMintFee() view returns (uint256)'],
            this.#provider);  
        const mintFeeUSD = await holographTreasuryContract.getHolographMintFee();

        const srcContract = new ethers.Contract(srcContractAddr,
            ['function getHolographDropERC721Source() view returns (address)'],
            this.#provider);
        const ERC721Source = await srcContract.getHolographDropERC721Source();

        const ERC721SourceContract = new ethers.Contract(ERC721Source,
            ['function dropsPriceOracle() view returns (address)'],
            this.#provider);
        const dropsPriceOracleProxy = await ERC721SourceContract.dropsPriceOracle();

        const dropsPriceOracleProxyContract = new ethers.Contract(dropsPriceOracleProxy,
            ['function getDropsPriceOracle() view returns (address)'],
            this.#provider);
        const dropsPriceOracle = await dropsPriceOracleProxyContract.getDropsPriceOracle();

        const dropsPriceOracleContract = new ethers.Contract(dropsPriceOracle,
            ['function convertUsdToWei(uint256) view returns (uint256)'],
            this.#provider);

        const mintFeeWei = await dropsPriceOracleContract.convertUsdToWei(mintFeeUSD);

        const value = mintFeeWei.div(100).mul(105);
        
        const transactionParams = [quantity];

        const {
            gasPrice,
            gasLimit,
            transactionCost
        } = await utils.getTxData(this.#chain, nftContract, 'purchase', transactionParams, value, logger);

        const totalCosts = transactionCost.add(value);
        const nativeBalance = await this.#provider.getBalance(this.#wallet.address);
        if (totalCosts.gt(nativeBalance)) {
            logger.warn(`Estimated costs ${fUnits(totalCosts, 18)} greater than balance ${fUnits(nativeBalance, 18)} ${rpc[this.#chain].native}. Try again in 60 sec ...`);
            await utils.timeout(60);
            return await this.mint(contract, quantity, logger);
        }

        let mintReciept;
        do {
            try {  
                const tx = await nftContract.purchase(...transactionParams, {
                        gasPrice,
                        gasLimit,
                        value,
                    });

                logger.info(`Mint transaction send`);
                mintReciept = await Promise.race([tx.wait(), utils.timeoutLimit(this.#config.transaction_timeout_limit, logger)]);
                    
                if (!mintReciept) {
                    logger.warn(`Time limit of ${this.#config.transaction_timeout_limit} sec has expired`);
                }
            } catch (error) {
                logger.warn(`Mint error with code [${error.code}]; reason: '${error.reason}'. Try again in 30 sec ...`);
                await utils.timeout(30);
                return await this.mint(contract, quantity, logger);
            }
        } while (!mintReciept);

        if (mintReciept.status) {
            logger.info(`Mint transaction is confirmed`);
        } else {
            logger.error(`Mint transaction ${mintReciept.transactionHash} is failed`);
        }
        
        return mintReciept.status;
    }

    bridge = async (dstChain, contract, logger) => {
        const nftScanChain = {
            arbitrum: 'arbitrum',
            fantom: 'fantom',
            polygon: 'polygon',
            avalanche: 'avalanche',
            optimism: 'optimism',
            bsc: 'bnb',
            ethereum: 'eth',
            base: 'base',
        };

        const nftScan = new NftscanEvm({
            apiKey: 'p217uAWiiXJHQNj6HiLk7FK0',
            chain: nftScanChain[this.#chain],
        });        

        const nftList = await nftScan.asset.getAssetsByAccount(this.#wallet.address, {
            contract_address: contract,
        });

        if (nftList.total == 0) {
            logger.error(`No Holograph NFT on address`);
            return false;
        } 
        
        const nftId = nftList.content[0].contract_token_id;

        const nftContract = new ethers.Contract(contract, [
                'function getHolograph() view returns (address)',
            ],
            this.#provider);
       
        const holographAddr = await nftContract.getHolograph();
        const holograph = new ethers.Contract(holographAddr, [
                'function getBridge() view returns (address)',
            ],
            this.#provider);

        const bridgeAddr = await holograph.getBridge();
        const bridge = new ethers.Contract(bridgeAddr, [
                'function bridgeOutRequest(uint32,address,uint256,uint256,bytes) payable',
                'function getMessageFee(uint32,uint256,uint256,bytes) view returns (uint256, uint256, uint256)',
            ],
            this.#wallet);

        const bridgeOutPayload = abiCoder.encode(['address', 'address', 'uint256'], [this.#wallet.address, this.#wallet.address, nftId]);
        const dstChainProvider = new ethers.providers.JsonRpcProvider(rpc[dstChain].url, rpc[dstChain].chain_id);
        const dstChainGasPrice = (await dstChainProvider.getGasPrice()).mul(4); // +20%
        
        let messageFee;
        try {
            messageFee = await bridge.getMessageFee(hlgChainId[dstChain], 0, dstChainGasPrice, bridgeOutPayload);
        } catch (error) {
            logger.warn(`getMessageFee error with code [${error.code}]; reason: '${error.reason}'. Try again in 60 sec...`);
            await utils.timeout(60);
            return await this.bridge(dstChain, contract, logger);
        }

        const value = messageFee[0].add(messageFee[1].div(100).mul(120));

        const transactionParams = [
            hlgChainId[dstChain],
            contract,
            0,
            dstChainGasPrice,
            bridgeOutPayload
        ];

        const {
            gasPrice,
            gasLimit,
            transactionCost
        } = await utils.getTxData(this.#chain, bridge, 'bridgeOutRequest', transactionParams, value, logger);
        
        const totalCosts = transactionCost.add(value);
        const nativeBalance = await this.#provider.getBalance(this.#wallet.address);

        if (totalCosts.gt(nativeBalance)) {
            logger.warn(`Estimated costs ${fUnits(totalCosts, 18)} greater than balance ${fUnits(nativeBalance, 18)} ${rpc[this.#chain].native}. Try again in 60 sec ...`);
            await utils.timeout(60);
            return await this.bridge(dstChain, contract, logger);
        }

        let bridgeReceipt;
        do {
            try {
                const tx = await bridge.bridgeOutRequest(...transactionParams, {
                        gasPrice,
                        gasLimit,
                        value,
                    });

                logger.info(`Bridge transaction send`);
                bridgeReceipt = await Promise.race([tx.wait(), utils.timeoutLimit(this.#config.transaction_timeout_limit, logger)]);
                    
                if (!bridgeReceipt) {
                    logger.warn(`Time limit of ${this.#config.transaction_timeout_limit} sec has expired`);
                }
            } catch (error) {
                logger.warn(`Bridge error with code [${error.code}]; reason: '${error.reason}'. Try again in 30 sec ...`);
                await utils.timeout(30);
                return await this.bridge(dstChain, contract, logger);
            }
        } while (!bridgeReceipt);

        if (bridgeReceipt.status) {
            logger.info(`Bridge transaction is confirmed`);
        } else {
            logger.error(`Bridge transaction ${bridgeReceipt.transactionHash} is failed`);
        }
        
        return bridgeReceipt.status;
    }
}

module.exports = Holograph;