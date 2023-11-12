'use strict'
const https = require('node:https')
const path = require("path")

module.exports =  class CoreApi {
    constructor(baseUrl, apiKey) {
        const url = new URL(baseUrl)
        this.options = {
            hostname: url.hostname,
            path: url.pathname,
            headers: {
                'X-Auth-Token': apiKey,
                'Accept': 'application/json',
            }
        }
    }

    async login() {
        const options = Object.assign({}, this.options)
        options.path = path.join(this.options.path, 'api', 'test')
        const data = await this._makeRequest(options)
        const body = data.body
        return true === body.success
    }

    async mergeDocument(type, hash, document) {
        const options = Object.assign({}, this.options)
        options.path = path.join(this.options.path, 'api', 'data', type, 'update', hash)
        options.method = 'POST'
        await this._makeRequest(options, document)
    }

    async _makeRequest(urlOptions, data = null) {
        return new Promise((resolve, reject) => {
            const req = https.request(urlOptions,
                (res) => {
                    let body = '';
                    res.on('data', (chunk) => (body += chunk.toString()));
                    res.on('error', reject);
                    res.on('end', () => {
                        if (res.statusCode >= 200 && res.statusCode <= 299) {
                            resolve({statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body)});
                        } else {
                            reject('Request failed. Status: ' + res.statusCode + ': ' + body);
                        }
                    });
                });
            req.on('error', reject);
            if (data) {
                req.write(JSON.stringify(data));
            }
            req.end();
        });
    }
}