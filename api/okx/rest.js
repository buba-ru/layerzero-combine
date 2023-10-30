'use strict';

const https = require('https');
const querystring = require('querystring');
const crypto = require('crypto');
const config = require('../../config/okx.js');

class REST {
    static #http = (url, options, data = null) => {
        if (options.method == 'GET') {
            if (data !== null && JSON.stringify(data) !== '{}') {
                url += '?' + querystring.stringify(data);
            }
            
            return new Promise((resolve, reject) => {
                let req = https.request(
                    `${url}`,
                    options,
                    (res) => {
                        let response = '';
                        res.on('data', function(chunk) {
                            response += chunk;
                        });
                        
                        res.on('end', function() {
                            try {
                                resolve(JSON.parse(response));
                            } catch {
                                resolve(null);
                            }
                            
                        });
                    }
                );
                req.on('error', function(err) {
                    reject(err);
                });
                req.end();
            });
        }
        
        if (options.method == 'POST') {
            return new Promise((resolve, reject) => {
                let req = https.request(
                    url,
                    options,
                    (res) => {
                        let response = '';
                        res.on('data', function(chunk) {
                            response += chunk;
                        });
                        
                        res.on('end', function() {
                            resolve(JSON.parse(response));
                        });
                    }
                );

                req.on('error', function(err) {
                    reject(err);
                });

                if (data !== null && JSON.stringify(data) !== '{}') {
                    req.write(JSON.stringify(data));
                }
                req.end();
            });
        }
        
    }

    static request = async (method, endpoint, data, api) => {
        const timestamp = (Date.now() / 1000).toString();
		const signature = this.#getSign(timestamp, method, endpoint, data, api);

        let response;
        do {
            response = await this.#http(`${config.url}${endpoint}`, {
                method: method,
                headers: {
                    'OK-ACCESS-KEY': config.auth[api].key,
                    'OK-ACCESS-SIGN': signature,
                    'OK-ACCESS-TIMESTAMP': timestamp,
                    'OK-ACCESS-PASSPHRASE': config.auth[api].passphrase,
                    'Content-Type': 'application/json',
                },
            },
            data);
        } while (response == null);

        return response;
    }

    static #getSign = (timestamp, method, endpoint, data, api) => {
        if (method == 'GET' || method == 'DELETE') {
			if (JSON.stringify(data) !== '{}') {
				data = '?' + querystring.stringify(data);
			} else {
				data = '';
			}
		}
		
		if (method == 'POST' || method == 'PUT') {
			if (JSON.stringify(data) !== '{}') {
				data = JSON.stringify(data);
			} else {
				data = '';
			}
		}
		
		const signPayload =  timestamp + method + endpoint + data;
		return crypto.createHmac('sha256', config.auth[api].secret).update(signPayload).digest('base64');
	}
}

module.exports = REST;