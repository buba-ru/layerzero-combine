module.exports = {
    L1_gasprice_cap: 30,
    L1_dependent_networks: ['arbitrum', 'optimism', 'base'],
    transaction_timeout_limit: 300,
    stargate_slippage: '0.5', // 0.5%
    sleep_between_tasks: [10, 20],
    custom_gas_price: {
        bsc:  '1.1',
    }
}