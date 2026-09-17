#!/usr/bin/env node
/** Send a plaintext amsg1 message on the mock chain from a fresh, auto-funded account.
 *  node scripts/mock-send.mjs <to> "<text>" [--from-mnemonic "..."]  */
import algosdk from 'algosdk'
const [to, text] = process.argv.slice(2)
const mi = process.argv.indexOf('--from-mnemonic')
const acct = mi > 0 ? algosdk.mnemonicToSecretKey(process.argv[mi + 1]) : algosdk.generateAccount()
const from = acct.addr.toString()
await fetch(`http://localhost:4001/fund?addr=${from}`, { method: 'POST' })
const algod = new algosdk.Algodv2('', 'http://localhost', 4001)
const sp = await algod.getTransactionParams().do()
const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: from, receiver: to, amount: 0, note: new TextEncoder().encode(`amsg1:p:${text}`), suggestedParams: sp })
const { txid } = await algod.sendRawTransaction(txn.signTxn(acct.sk)).do()
console.log(JSON.stringify({ from, txid, mnemonic: algosdk.secretKeyToMnemonic(acct.sk) }))
