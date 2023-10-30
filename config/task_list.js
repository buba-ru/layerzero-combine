module.exports = [
/*
	Available features
	
    {action: 'topup', chain: 'arbitrum', token: 'USDC', amount: '0:0'},
    {action: 'wait_funds', chain: 'arbitrum', token: 'USDC'},
    {action: 'stargate_bridge', route: 'arbitrum@USDC:polygon@USDC', dstGasForFee: 0.000025},
    {action: 'withdraw', chain: 'arbitrum', token: 'USDC'},
    {action: 'withdraw_native', chain: 'fantom'},
    {action: 'merkly_oft_mint', chain: 'polygon', amount: 5}
    {action: 'merkly_oft_bridge', chain: 'polygon:zora'}
    {action: 'pancake_buy_token', chain: 'bsc', token: 'ONE', amount:'0.00005:0.0001'},
    {action: 'harmony_bridge', chain: 'bsc:harmony', token: 'ONE'}
*/

/*
	Example of randomization
    [   'shuffle',
        [   'random',
            [   'consistently',
                {action: 'pancake_buy_token', chain: 'bsc', token: 'ONE', amount:'0.00005:0.0001'},
                {action: 'harmony_bridge', chain: 'bsc:harmony', token: 'ONE'},
            ],
            [   'consistently',
                {action: 'pancake_buy_token', chain: 'bsc', token: 'DAI', amount:'0.00005:0.0001'},
                {action: 'harmony_bridge', chain: 'bsc:harmony', token: 'DAI'},
            ],
        ],
        [   'random',
            [   'consistently',
                {action: 'merkly_oft_mint', chain: 'bsc', amount: 1},
                [   'random',
                    {action: 'merkly_oft_bridge', chain: 'bsc:dfk'},
                    {action: 'merkly_oft_bridge', chain: 'bsc:gnosis'},
                    {action: 'merkly_oft_bridge', chain: 'bsc:kava'},
                    {action: 'merkly_oft_bridge', chain: 'bsc:loot'},
                    {action: 'merkly_oft_bridge', chain: 'bsc:moonbeam'},
                    {action: 'merkly_oft_bridge', chain: 'bsc:arbitrum_nova'},
                ]
            ],
        ],
    ]
*/

];