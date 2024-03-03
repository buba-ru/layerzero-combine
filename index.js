'use strict';

const {ethers} = require('ethers');
const utils = require('./api/utils');
const Executor = require('./api/executor');
const taskList = require('./config/task_list');
const config = require('./config/config');
const pk = utils.fileToArr('./config/private.keys');
const addr = utils.fileToArr('./config/addresses');


ethers.utils.Logger.setLogLevel('error');

const processTask = async (task, executor) => {
    if (task.hasOwnProperty('action')) {
        await executor.perform(task);
        return;
    }

    let mode;
    if (Array.isArray(task)) {
        mode = task.shift();

        if (mode == 'random') {
            await processTask(task[Math.floor(Math.random() * task.length)], executor);
        }
    
        if (mode == 'consistently') {
            for (let t of task) {
                await processTask(t, executor);
            }
        }

        if (mode == 'shuffle') {
            shuffle(task);
            task.unshift('consistently')
            await processTask(task, executor);
        }
    }
}

const shuffle = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

(async () => {
    let progress = 1;

    const pkAddrComparison = {};
    for (const privateKey of pk) {
        pkAddrComparison[ethers.utils.computeAddress(privateKey)] = privateKey;
    }

    for (const address of addr) {
        if (!pkAddrComparison.hasOwnProperty(address)) {
            continue;
        }

        const privateKey = pkAddrComparison[address];

        console.log(`[${progress}] ${address} > Start`.bgMagenta);
        const executor = new Executor(privateKey, config);
        for (let k = 0; k < taskList.length; k++) {
            await processTask(JSON.parse(JSON.stringify(taskList[k])), executor);
        }

        console.log(`[${progress}] ${address} > Finish`.bgMagenta);
        await utils.timeout(utils.getRandomInt(...config.sleep_between_accs), true);
        console.log(`\n`);
        progress++;
    }
})();