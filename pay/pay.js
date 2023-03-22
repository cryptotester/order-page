import { ABI_PAYMENTSPLITTER3 } from "./abi_paymentSplitter3.js";
import { ERC20_ABI } from "./abi_erc20.js";
import { CHAIN_INFO } from "./chainInfo.js";
import { init, showOrHideError, onConnect, handleLowBalance, switchNetwork, sleep, getSupportedChainNames } from "./shared.js";

const IS_PROD = false; // false = TESTNET, true = PROD

// paymentSplitter PROJECT_ID to use, every project gets a different PROJECT_ID don't just reuse 0 all the time, ask the smart contract dev or the project manager which PROJECT_ID to use
const PROJECT_ID = 0;

const SWITCH_TO_CHAIN_ID = IS_PROD ? 240 : 4002;

const Web3 = window.Web3;

let web3, chainId, selectedAccount, contract, contractAddress;

async function fetchAccountData() {
  showOrHideError();

  web3 = new Web3(window.provider);

  if (SWITCH_TO_CHAIN_ID) await switchNetwork(web3, SWITCH_TO_CHAIN_ID);
  
  chainId = await web3.eth.getChainId();

  contractAddress = CHAIN_INFO[chainId]?.contractAddress;
  if (contractAddress != undefined) {
    contract = await new web3.eth.Contract(ABI_PAYMENTSPLITTER3, contractAddress);
    document.querySelector("#prepare").style.display = "none";
    document.querySelector("#connected").style.display = "block";    
  } else {
    let chainMessage;
    if (SWITCH_TO_CHAIN_ID) {
      chainMessage = `Please connect to ${CHAIN_INFO[SWITCH_TO_CHAIN_ID].name}`;
    } else {
      let supportedChainNames = getSupportedChainNames(CHAIN_INFO, IS_PROD);
      chainMessage = `Please connect to one of our supported chains: ${supportedChainNames.join(', ')}`
    }
    showOrHideError(chainMessage);
    return;
  }

  // Populate list of coins based on selected chain
  // $('input[name="coin"]').change(function() {
  //   var selectedValue = $(this).val();
  //   // Call your function here and pass in the selected value
  //   myFunction(selectedValue);
  // });

  const accounts = await web3.eth.getAccounts();
  selectedAccount = accounts[0];

  // TODO: walletAddress hardcoded only for testing. Comment on PROD!
  let walletAddress = '0x30b2c8c593944b6bdb58aca704545747dfc11c56'; // 37 
  // TODO: uncomment the following line on PROD
  // let walletAddress = selectedCoin;
  const ownedNftsQuery = `https://api.binarypunks.com/nfts.php?wallet=${walletAddress}`;
  const ownedNfts = await axios.get(ownedNftsQuery)
    .then(response => {
      return response.data;
    })
    .catch(error => {
      console.log(error);
      return [];
    });
  console.log('Owned NFTs', ownedNfts);

  // let ipfsUrl = 'https://ipfs.io/ipfs/'; // This is the "original IPFS"
  let ipfsCacheUrl = 'https://nftstorage.link/ipfs/'; // NFT Storage is way faster

  let nfts = ownedNfts.map(x => {
    let result = {
      token_name: x.name,
      token_id: x.token_id,
      token_uri: x.token_uri,
      token_address: x.token_address,
    };
    let metadataStr = x.metadata;
    if (metadataStr) {
      let metadata = JSON.parse(metadataStr);
      result.name = metadata.name;
      if (metadata.image) {
        result.image = metadata.image.replace('ipfs://', ipfsCacheUrl);
      } else {
        // no image
        // TODO: use a default image?
      }
    } else {
      // no metadata
      result.name = result.name || `${x.name} #${x.token_id}`;
    }
    // console.log(result);
    return result;
  });

  let template = $('#gallery-template').html();
  Mustache.parse(template);
  let rendered = Mustache.render(template, { nfts: nfts });
  $('#gallery').html(rendered);
}

async function getTokenContract(tokenAddress) {
  // console.log(`ERC20 Token address: ${tokenAddress}`);
  return new web3.eth.Contract(ERC20_ABI, tokenAddress);
}

async function getRate(symbol) {
  symbol = symbol.toUpperCase();
  let priceApiUrl = CHAIN_INFO[chainId].currencies[symbol].priceApiUrl;
  let fallbackRate = CHAIN_INFO[chainId].currencies[symbol].fallbackRate;
  
  if (priceApiUrl) {
    // Get e.g. {"symbol":"MATICUSDT","price":"1.18180000"}
    const binanceRate = await axios.get(priceApiUrl)
      .then(response => {
        return response.data;
      })
      .catch(error => {
        console.log(error);
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

    let total = $("#total").val();
    let expenses = $("#expenses").val();
    let selectedCoin = $('input[name="coin"]:checked').val();
    selectedCoin = selectedCoin.toUpperCase();
    let symbol = selectedCoin == 'NATIVE' ? CHAIN_INFO[chainId].currencies['NATIVE'].symbol : selectedCoin;
    console.log('Selected payment:', symbol);

    let rate = await getRate(selectedCoin);

    let lowBalanceMessage = `You don't have enough balance. You need [AMOUNT].`;
    let paymentReceipt;
    if (selectedCoin == 'NATIVE') {
      console.log(`Initiating native coin payment`);
      
      let totalValue = BN(1e18 * parseFloat(total) / rate); // Get the price in wei (amount of native coin * 1e18)
      let expensesValue = BN(1e18 * parseFloat(expenses) / rate);
      // console.log(`totalValue ${totalValue}`);
      let humanFriendlyAmount = web3.utils.fromWei(totalValue.toString());
      let humanFriendlyExpensesAmount = web3.utils.fromWei(expensesValue.toString());
      console.log('Total Value:', totalValue.toString(), 'Human friendly:', humanFriendlyAmount);
      console.log('Expenses Value:', expensesValue.toString(), 'Human friendly expenses:', humanFriendlyExpensesAmount);

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

      paymentReceipt = await contract.methods.splitPayment(PROJECT_ID, expensesValue).send({ from: selectedAccount, value: totalValue });
      if (!paymentReceipt) {
        console.log(`Payment error`);
      }

      interactionDone();
    } else {
      // ERC20 token payment, e.g. USDC or any other token
      console.log(`Initiating ERC-20 token payment`);
      
      const token = CHAIN_INFO[chainId].currencies[selectedCoin];
      const tokenContract = await getTokenContract(token.address);
      let multiplier = 10 ** token.decimals; // Use the proper token decimals (not only 18, USDC e.g. has only 6)

      let totalValue = BN(multiplier * parseFloat(total) / rate);
      let expensesValue = BN(multiplier * parseFloat(expenses) / rate);
      let humanFriendlyAmount = parseFloat(totalValue) / parseFloat(multiplier);
      let humanFriendlyExpensesAmount = parseFloat(expensesValue) / parseFloat(multiplier);
      console.log('Total Value:', totalValue.toString(), 'Human friendly:', humanFriendlyAmount);
      console.log('Expenses Value:', expensesValue.toString(), 'Human friendly expenses:', humanFriendlyExpensesAmount);

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
          })
          .then(x => { 
            return x;
          });

        if (!approveResult) {
          showOrHideError('You must approve in order to pay');
          interactionDone();
          return;
        }
      }

      console.log(`Initiating payment in ${selectedCoin}, token address: ${token.address}`);
      paymentReceipt = await contract.methods.splitTokenPayment(PROJECT_ID, token.address, totalValue.toString(), expensesValue.toString()).send({ from: selectedAccount })
        .catch(x => {
          error = x;
        })
        .then(x => { 
          return x;
        });
    } // End payment block

    if (paymentReceipt) {
      // Payment OK
      console.log(paymentReceipt);
      let transactionUrl = `${CHAIN_INFO[chainId].explorerUrl}/tx/${paymentReceipt.transactionHash}`;
      // TODO: after payment, if you need to call a javascript function to show a success page etc., put it here
      console.log(`THANK YOU. Transaction`, transactionUrl);
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
}

function interactionDone() {
  $('#preview').html('').hide();
  $("#loading").hide();
  $('#btn-pay').prop('disabled', false);
}

window.addEventListener('load', async () => {
  init();
  document.querySelector("#btn-connect").addEventListener("click", async () => {
    await onConnect(fetchAccountData);
  });
  document.querySelector("#btn-pay").addEventListener("click", pay);
  // document.querySelector("input.erc20").addEventListener("click", async(e) => {
  //   console.log(`ERC20 token clicked: handle allowance for`, e.target.value);
  // });
});
