const CHAIN_INFO = {
  4002: {
    name: "Fantom Testnet",
    isTestnet: true,
    explorerUrl: "https://testnet.ftmscan.com",
    contractAddress: "0xfb0F0069D94a491A2a312DDAdc717d9bbC1a5a98", // paymentSplitter2 smart contract address
    currencies: {
      "NATIVE": {
        symbol: "FTM",
        fallbackRate: 0.5,
        priceApiUrl: "https://api.binance.com/api/v3/ticker/price?symbol=FTMUSDT",
      },
      "TC":  {
        fallbackRate: 1.3,
        address: "0x19EA0fE857b4f007fAD4A58c23737390F6DDc861",
        decimals: 18,
        priceApiUrl: "https://api.binance.com/api/v3/ticker/price?symbol=MATICUSDT",
      },
      "USD":  {
        fallbackRate: 1,
        address: "0xa70049260772E13dfFaC2aF8445159595fdf4C98",
        decimals: 6,
      }
    },
    250: {
      name: "Fantom Opera",
      explorerUrl: "https://ftmscan.com",
      contractAddress: "", // paymentSplitter2 smart contract address
      currencies: {
        "NATIVE": {
          symbol: "FTM",
          fallbackRate: 0.5,
          priceApiUrl: "https://api.binance.com/api/v3/ticker/price?symbol=FTMUSDT",
        },
        "USDC":  {
          fallbackRate: 1,
          address: "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75",
          decimals: 6,
        },
        "USDT":  {
          fallbackRate: 1,
          address: "0x049d68029688eabf473097a2fc38ef61633a3c7a",
          decimals: 6,
        }
      }
    }
  }
};
export{CHAIN_INFO};