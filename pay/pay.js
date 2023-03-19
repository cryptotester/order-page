import { payAbi as ABI } from "./pay_abi.js";
import { erc20Abi as ERC20_ABI } from "./erc20minimal_abi.js";
import { init, showOrHideError, onConnect, handleLowBalance } from "./shared.js";

// paymentSplitter PROJECT_ID to use, every project gets a different PROJECT_ID don't just reuse 0 all the time, ask the smart contract dev or the project manager which PROJECT_ID to use
const PROJECT_ID = 0;

const chainInfo = {
  4002: {
    name: "Fantom Testnet",
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
}

const Web3 = window.Web3;

let web3, chainId, selectedAccount, contract, contractAddress;

async function fetchAccountData() {
  showOrHideError();

  web3 = new Web3(window.provider);
  // console.log("Web3 instance is", web3);

  chainId = await web3.eth.getChainId();

  // Populate list of coins based on selected chain
  // $('input[name="coin"]').change(function() {
  //   var selectedValue = $(this).val();
  //   // Call your function here and pass in the selected value
  //   myFunction(selectedValue);
  // });

  const accounts = await web3.eth.getAccounts();
  // console.log("Got accounts", accounts);
  selectedAccount = accounts[0];

  let walletAddress = selectedAccount;

  const ownedNftsQuery = `https://api.binarypunks.com/nfts.php?wallet=${walletAddress}`;
  const ownedNfts = await axios.get(ownedNftsQuery)
  .then(response => {
    // console.log('Axios got a response...');console.log(response);
    return response.data;
  })
  .catch(error => {
    console.log(error);
    // Use fallback rate in case of error
    return [];
  });
  console.log('Owned NFTs', ownedNfts);

  let nfts = ownedNfts.map(x => {
    let result = {
      name: `${x.name} #${x.token_id}`,
      image: 'https://picsum.photos/id/1/100/100' // TODO: use better default image
    };
    let metadataStr = x.metadata;
    if (metadataStr) {
      let metadata = JSON.parse(metadataStr);
      if (metadata.name) result.name = metadata.name;
      if (metadata.image) {
        // TODO: use ipfs caching server
        result.image = metadata.image.replace('ipfs://', 'https://ipfs.io/ipfs/');
      } else {
        // console.log(x);
      }
    } else {
      // console.log(x);
      result.token_uri = x.token_uri;
    }
    // console.log(result);
    return result;
  });

  let template = $('#gallery-template').html();
  Mustache.parse(template);
  let rendered = Mustache.render(template, { nfts: nfts });
  $('#gallery').html(rendered);

  console.log('contract address', chainInfo[chainId]);
  contractAddress = chainInfo[chainId]?.contractAddress;
  if (contractAddress != undefined) {
    contract = await new web3.eth.Contract(ABI, contractAddress);
    // console.log(contract);
    document.querySelector("#prepare").style.display = "none";
    document.querySelector("#connected").style.display = "block";    
  } else {
    // showOrHideError('Please connect to one of our supported chains: Fantom Opera (more chains to be added)');
    showOrHideError('Please connect to Fantom Opera');
  }
}

async function getTokenContract(tokenAddress) {
  // console.log(`ERC20 Token address: ${tokenAddress}`);
  return new web3.eth.Contract(ERC20_ABI, tokenAddress);
}


async function getRate(symbol) {
  symbol = symbol.toUpperCase();
  let priceApiUrl = chainInfo[chainId].currencies[symbol].priceApiUrl;
  let fallbackRate = chainInfo[chainId].currencies[symbol].fallbackRate;
  
  if (priceApiUrl) {
    // Get e.g. {"symbol":"MATICUSDT","price":"1.18180000"}
    const binanceRate = await axios.get(priceApiUrl)
      .then(response => {
        // console.log('Axios got a response...');console.log(response);
        return response.data;
      })
      .catch(error => {
        console.log(error);
        // Use fallback rate in case of error
        return { price: fallbackRate }
      });
    return parseFloat(binanceRate.price);
  } else {
    return fallbackRate;
  }
}

async function pay() {
  showOrHideError();
  try {
    const BN = web3.utils.toBN;

    let subtotal = $("#subtotal").val();
    let selectedCoin = $('input[name="coin"]:checked').val();
    selectedCoin = selectedCoin.toUpperCase();
    let symbol = selectedCoin == 'NATIVE' ? chainInfo[chainId].currencies['NATIVE'].symbol : selectedCoin;
    console.log('Selected payment:', symbol);

    let rate = await getRate(selectedCoin);
    // console.log(rate);

    let lowBalanceMessage = `You don't have enough balance. You need [AMOUNT].`;
    let paymentResult;
    if (selectedCoin == 'NATIVE') {
      console.log(`Initiating native coin payment`);
      
      let totalValue = BN(1e18 * parseFloat(subtotal) / rate); // Get the price in wei (amount of native coin * 1e18)
      console.log(`totalValue ${totalValue}`);
      let humanFriendlyAmount = web3.utils.fromWei(totalValue.toString());
      console.log('Total Value:', totalValue.toString(), 'Human friendly:', humanFriendlyAmount);

      if (totalValue == 0) {
        showOrHideError('The amount must be > 0 in order to proceed');
        return;
      }
      $('#preview').html(`To pay: ${humanFriendlyAmount} ${symbol}`).show();
  
      let hasEnoughBalance = await handleLowBalance(web3, selectedAccount, totalValue, lowBalanceMessage);
      if (!hasEnoughBalance) {
        return;
      }

      // Native payment, e.g. ETH on Ethereum, FTM on Fantom, MATIC on Polygon etc.

      interactionInProgress();

      paymentResult = await contract.methods.splitPayment(PROJECT_ID).send({ from: selectedAccount, value: totalValue });
      if (!paymentResult) {
        console.log(`Payment error`);
      }

      interactionDone();
    } else {
      // ERC20 token payment, e.g. USDC or any other token
      console.log(`Initiating ERC-20 token payment`);
      
      const token = chainInfo[chainId].currencies[selectedCoin];
      const tokenContract = await getTokenContract(token.address);
      let multiplier = 10**token.decimals; // Use the proper token decimals (not only 18, USDC e.g. has only 6)

      let totalValue = BN(multiplier * parseFloat(subtotal) / rate);
      let humanFriendlyAmount = parseFloat(totalValue) / parseFloat(multiplier);
      console.log('Total Value:', totalValue.toString(), 'Human friendly:', humanFriendlyAmount);

      if (totalValue == 0) {
        showOrHideError('The amount must be > 0 in order to proceed');
        return;
      }
      $('#preview').html(`To pay: ${humanFriendlyAmount.toFixed(2)} ${selectedCoin}`).show();
  
      let hasEnoughBalance = await handleLowBalance(web3, selectedAccount, totalValue, lowBalanceMessage, tokenContract);
      if (!hasEnoughBalance) {
        return;
      }

      interactionInProgress();
      let error;

      let allowance = await tokenContract.methods.allowance(selectedAccount, contractAddress).call();
      console.log(`Actual allowance: ${allowance}`);
      if (BN(allowance).lt(BN(totalValue))) {
        // Initiating approval request
        console.log(`Asking approval to spend ${humanFriendlyAmount} ${selectedCoin} (* 1e${token.decimals} = ${totalValue})`);
        let approveResult = await tokenContract.methods.approve(contractAddress, totalValue.toString()).send({ from: selectedAccount })
          .catch(x => {
            error = x;
            // console.log(x.message)
          })
          .then(x => { 
            // console.log(x);
            return x;
          });

        if (!approveResult) {
          showOrHideError('You must approve in order to pay');
          interactionDone();
          return;
        }
      }

      console.log(`Initiating payment in ${selectedCoin}, token address: ${token.address}`);
      paymentResult = await contract.methods.splitTokenPayment(PROJECT_ID, token.address, totalValue.toString()).send({ from: selectedAccount })
        .catch(x => {
          error = x;
          // console.log(x.message)
        })
        .then(x => { 
          // console.log(x);
          return x;
        });
    } // End payment block

    if (paymentResult) {
      // Payment OK
      console.log(paymentResult);
      // TODO: after payment, if you need to call a javascript function to show a success page etc., put it here
      console.log(`THANK YOU`);
    }

    interactionDone();
    
  } catch (e) {
    interactionDone();
    if (!e.message.includes('User denied transaction signature')) {
      console.log('Error: ', e.message);
    }
  }
}

function interactionInProgress() {
  // show loading indicator and hide mint button
  $('#btn-pay').prop('disabled', true);
  $("#loading").show();
  // $(".after-interaction").hide(); // hiding previously shown confirmation
}

function interactionDone() {
  $('#preview').html('').hide();
  $("#loading").hide();
  $('#btn-pay').prop('disabled', false);
}

window.addEventListener('load', async () => {
  init();
  // updateMintInfo(chainId, ABI, CONTRACT_ADDRESS);
  document.querySelector("#btn-connect").addEventListener("click", async () => {
    await onConnect(fetchAccountData);
  });
  document.querySelector("#btn-pay").addEventListener("click", pay);
  // document.querySelector("input.erc20").addEventListener("click", async(e) => {
  //   console.log(`ERC20 token clicked: handle allowance for`, e.target.value);
  // });
});
