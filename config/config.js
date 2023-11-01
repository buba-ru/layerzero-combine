module.exports = {
    L1_gasprice_cap: 35,
    L1_dependent_networks: ['arbitrum', 'optimism', 'base'],
    transaction_timeout_limit: 300,
    stargate_slippage: '0.5', // 0.5%
    sleep_between_accs: [120, 300],
    sleep_between_tasks: [15, 30],
    custom_gas_price: {
        bsc:  '1.1',
    }
}