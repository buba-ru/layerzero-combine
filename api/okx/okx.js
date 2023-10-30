'use strict';

const api = require('./rest.js');
const config = require('../../config/okx.js');
const timeout = ms => new Promise(res => setTimeout(res, ms));

class Okx {
    #chain;
    #coin;

    constructor (chain, coin) {
        this.#chain = config.chains_comparison[chain];
        this.#coin = coin;
    }

    #getCoinBalance = async (api_id) => {
        const method = 'GET';
        const endpoint = '/api/v5/asset/balances';
        const data = {ccy: this.#coin};

        const resp = await api.request(method, endpoint, data, api_id);
        if (resp.code == '0') {
            return +resp.data[0].availBal;
        } else {
            await timeout(10 * 1000);
            return await this.#getCoinBalance(api_id);
        }
        
    }

    #getCoinInfo = async (api_id) => {
        const method = 'GET';
        const endpoint = '/api/v5/asset/currencies';
        const data = {ccy: this.#coin};

        const resp = await api.request(method, endpoint, data, api_id);
        for (let i = 0; i < resp.data.length; i++) {
            if (resp.data[i].chain == `${this.#coin}-${this.#chain}`) {
                return {fee: +resp.data[i].minFee, withdrawal_precision: +resp.data[i].wdTickSz};
            }
        }

        throw `Chain ${this.#chain} was not found for the coin ${this.#coin}`;       
    }

    #requestWithdrawal = async (amount, fee, address, chain, api_id) => {
        const method = 'POST';
        const endpoint = '/api/v5/asset/withdrawal';
        const data = {
            ccy: this.#coin,
            amt: amount,
            dest: '4',
            toAddr: address,
            fee: fee,
            chain: `${this.#coin}-${chain}`
        };

        const resp = await api.request(method, endpoint, data, api_id);
        
        if (resp.code == '0') {
            return {result: true};
        } else {
            return {result: false, msg: resp.msg};
        }
    }

    #requestInternalWithdrawal = async (amount, address, api_id) => {
        const method = 'POST';
        const endpoint = '/api/v5/asset/withdrawal';
        const data = {
            ccy: this.#coin,
            amt: amount,
            dest: '3',
            toAddr: address,
            fee: 0,
        };

        const resp = await api.request(method, endpoint, data, api_id);
        
        if (resp.code == '0') {
            return {result: true};
        } else {
            return {result: false, msg: resp.msg};
        }
    }

    #getSubAccountList = async (api_id) => {
        const method = 'GET';
        const endpoint = '/api/v5/users/subaccount/list';
        const data = {};

        const resp = await api.request(method, endpoint, data, api_id);
        if (resp.code == '0') {
            return resp.data.map(subacc => subacc.subAcct);
        } else {
            await timeout(60 * 1000);
            return await this.#getSubAccountList(api_id);
        }   
    }

    #getSubAccountBalance = async (subacc, api_id) => {
        const method = 'GET';
        const endpoint = '/api/v5/asset/subaccount/balances';
        const data = {
            subAcct: subacc,
            ccy: this.#coin
        };

        const resp = await api.request(method, endpoint, data, api_id);
        if (resp.code == '0') {
            return +resp.data[0].availBal;
        } else {
            await timeout(10 * 1000);
            return await this.#getSubAccountBalance(subacc, api_id);
        }
        
    }

    #transferFromSubAccount = async (from, amount, api_id) => {
        const method = 'POST';
        const endpoint = '/api/v5/asset/transfer';
        const data = {
            ccy: this.#coin,
            amt: amount,
            from: '6',
            to: '6',
            subAcct: from,
            type: '2'
        };

        const resp = await api.request(method, endpoint, data, api_id);
        return +resp.data[0].amt;
    }

    #getRandomDecimal(min, max, precision) {
        let amount = Math.random() * (max - min) + min;
        return +amount.toFixed(precision);
    }

    fundAccumulation = async (logger) => {
        logger.info(`Accumulation funds to main account on OKX`.bgBlue);

        const auth = config.auth;
        for (let i = 0; i < auth.length; i++) {
            // Получить список субаккаунтов
            const subAccsList = await this.#getSubAccountList(i);

            // Проверить баланс на каждом субаккаунте
            const subAccsBalances = [];
            for (let s = 0; s < subAccsList.length; s++) {
                const subAccBalance = await this.#getSubAccountBalance(subAccsList[s], i);
                subAccsBalances.push({subacc_name: subAccsList[s], balance: subAccBalance});
                await timeout(1000);
            }
            

            // Перевести средства с суббакаунта на основной аккаунт
            let transferedAmount = 0;
            for (let s = 0; s < subAccsBalances.length; s++) {
                if (subAccsBalances[s].balance > 0) {
                    transferedAmount += await this.#transferFromSubAccount(subAccsBalances[s].subacc_name, subAccsBalances[s].balance, i);
                    await timeout(1000);
                }
            }

            if (transferedAmount > 0) {
                logger.info(`Successfull transfer from subaccs to main account (api-key: [${i}] ${auth[i].key}): ${transferedAmount} ${this.#coin}`);
            }
        
            // Если auth != 0, вывести средства на основной аккаунт
            if (i > 0) {
                const balance = await this.#getCoinBalance(i);
                // Вывести средства
                const resp = await this.#requestInternalWithdrawal(balance, 'evgeny-nosikov@yandex.ru', i)
                //const resp = await this.#requestWithdrawal(balance, 0, config.main_address, 'Arbitrum One (Bridged)', i);
                if (balance > 0) {
                    if (!resp.result) {
                        logger.warn(`Error when withdraw to main acc (api-key: [${i}] ${auth[i].key}): ${resp.msg}`);
                    } else {
                        logger.info(`Successfull withdraw to main account (from api-key: [${i}] ${auth[i].key}): ${balance} ${this.#coin}`);
                    }
                }                    
            }
        }
    }

    topUpAddress = async (address, min, max) => { 
        const balance = await this.#getCoinBalance( 0);
        const tokenInfo = await this.#getCoinInfo(0);
        const topUpAmount = this.#getRandomDecimal(min, max, tokenInfo.withdrawal_precision);
        
        if (balance < topUpAmount) {
            return {result: false, msg: 'Insufficient funds on OKX'}
        }

        const resp = await this.#requestWithdrawal(topUpAmount, tokenInfo.fee, address, this.#chain, 0);
    
        if (!resp.result) {
            return {result: false, msg: resp.msg}
        }

        return {result: true, data: topUpAmount}
    }
}

module.exports = Okx;