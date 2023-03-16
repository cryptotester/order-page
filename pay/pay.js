import { payAbi as ABI } from "./pay_abi.js";
import { erc20Abi as ERC20_ABI } from "./erc20minimal_abi.js";
import { init, updateMintInfo, showOrHideError, onConnect, switchNetwork, handleLowBalance } from "./shared.js";

// paymentSplitter PROJECT_ID to use, every project gets a different PROJECT_ID don't just reuse 0 all the time, ask the smart contract dev or the project manager which PROJECT_ID to use
const PROJECT_ID = 0;

const chainInfo = {
  4002: {
    name: "Fantom Testnet",
    symbol: "FTM",
    minRate: 0.35,
    priceApiUrl: "",
    contractAddress: "0xfb0F0069D94a491A2a312DDAdc717d9bbC1a5a98", // paymentSplitter2 smart contract address
    paymentTokens: {
      "testcoin":  {
        symbol: "TC",
        address: "0x19EA0fE857b4f007fAD4A58c23737390F6DDc861",
        decimals: 18,
        priceApiUrl: "",
      },
      "testusd":  {
        symbol: "USD",
        address: "0xa70049260772E13dfFaC2aF8445159595fdf4C98",
        decimals: 6,
        priceApiUrl: "",
      }
    }
  }
}

const contractChainId = 4002;

// TODO: check supported chain

const Web3 = window.Web3;

let web3, selectedAccount, contract, contractAddress;

async function fetchAccountData() {
  showOrHideError();

  web3 = new Web3(window.provider);
  // console.log("Web3 instance is", web3);

  // await switchNetwork(web3, contractChainId);
  // TODO check supported chain

  // Populate list of coins based on selected chain
  // $('input[name="coin"]').change(function() {
  //   var selectedValue = $(this).val();
  //   // Call your function here and pass in the selected value
  //   myFunction(selectedValue);
  // });

  const accounts = await web3.eth.getAccounts();
  // console.log("Got accounts", accounts);
  selectedAccount = accounts[0];

  document.querySelector("#prepare").style.display = "none";
  document.querySelector("#connected").style.display = "block";

  console.log('contract address', chainInfo[contractChainId]);
  contractAddress = chainInfo[contractChainId].contractAddress;
  contract = await new web3.eth.Contract(ABI, contractAddress); // TODO: update connected chainId
  // console.log(contract);
}

async function getTokenContract(tokenAddress) {
  // console.log(`ERC20 Token address: ${tokenAddress}`);
  return new web3.eth.Contract(ERC20_ABI, tokenAddress);
}

async function pay() {
  showOrHideError();
  try {
    let BN = web3.utils.toBN;
    let selectedCoin = $('input[name="coin"]:checked').val();
    console.log('Selected coin:', selectedCoin);

    let paymentResult;
    if (selectedCoin == 'native') {
      let symbol = chainInfo[contractChainId].symbol;
      let subtotal = $("#subtotal").val(); // TODO: convert USD price from global config, fetch price from api and convert usd to token
      let rate = 0.35 * 1e18; // TODO: fetch this via api or use a default/minimum rate
      let totalWei = BN(subtotal.toString()).mul(BN(rate.toString()));
      // let totalWei = BN(web3.utils.toWei(totalNative.toString())); // https://web3js.readthedocs.io/en/v1.2.11/web3-utils.html#towei
      let humanFriendlyAmount = web3.utils.fromWei(totalWei.toString());
      console.log('Total Value:', totalWei.toString(), 'Human friendly:', humanFriendlyAmount);

      $('#preview').html(`To pay: ${humanFriendlyAmount} ${symbol}`).show();
  
      let lowBalanceMessage = `You don't have enough balance. You need [AMOUNT].`;
      let hasEnoughBalance = await handleLowBalance(web3, selectedAccount, totalWei, lowBalanceMessage);
      if (!hasEnoughBalance) {
        return;
      }

      // Native payment, e.g. ETH on Ethereum, FTM on Fantom, MATIC on Polygon etc.

      interactionInProgress();

      paymentResult = await contract.methods.splitPayment(PROJECT_ID).send({ from: selectedAccount, value: totalWei });
      if (!paymentResult) {
        console.log(`Payment error`);
      }

      interactionDone();

      // End Native payment
    } else {
      // ERC20 token payment, e.g. USDC or any other token
      const coinInfo = chainInfo[contractChainId].paymentTokens[selectedCoin];
      const tokenAddress = coinInfo.address;
      const tokenDecimals = coinInfo.decimals;
      const tokenContract = await getTokenContract(tokenAddress);
      let symbol = coinInfo.symbol;
      let multiplier = 10**tokenDecimals;

      let subtotal = $("#subtotal").val(); // TODO: convert USD price from global config, fetch price from api and convert usd to token
      // Not all tokens have 18 decimals, some tokens use less; e.g. USDC (not on all chains) uses 6 decimals
      let rate = 0.993764 * multiplier; // It's important to convert the number using the proper decimals
      let totalValue = BN(subtotal.toString()).mul(BN(rate.toString()));
      let humanFriendlyAmount = parseFloat(totalValue) / parseFloat(multiplier);
      console.log('Total Value:', totalValue.toString(), 'Human friendly:', humanFriendlyAmount);

      $('#preview').html(`To pay: ${humanFriendlyAmount.toFixed(2)} ${symbol}`).show();
  
      let lowBalanceMessage = `You don't have enough balance. You need [AMOUNT].`;
      let hasEnoughBalance = await handleLowBalance(web3, selectedAccount, totalValue, lowBalanceMessage, tokenContract);
      if (!hasEnoughBalance) {
        return;
      }

      interactionInProgress();
      let error;

      let allowance = await tokenContract.methods.allowance(selectedAccount, contractAddress).call();
      console.log(`Allowance: ${allowance}`);
      if (BigInt(allowance) < BigInt(totalValue)) {
        // Initiating approval request
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

      console.log(`Initiating payment in ${selectedCoin}, tokenAddress: ${tokenAddress}`);
      paymentResult = await contract.methods.splitTokenPayment(PROJECT_ID, tokenAddress, totalValue.toString()).send({ from: selectedAccount })
        .catch(x => {
          error = x;
          // console.log(x.message)
        })
        .then(x => { 
          // console.log(x);
          return x;
        });
      // End ERC20 token payment
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
  // updateMintInfo(contractChainId, ABI, CONTRACT_ADDRESS);
  document.querySelector("#btn-connect").addEventListener("click", async () => {
    await onConnect(fetchAccountData);
  });
  document.querySelector("#btn-pay").addEventListener("click", pay);
  document.querySelector("input.erc20").addEventListener("click", async(e) => {
    console.log(`ERC20 token clicked: handle allowance for`, e.target.value);
  });
});
