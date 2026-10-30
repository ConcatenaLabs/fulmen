# Connecting to an operator's gateways from the command line

This is the path to the same result as Fulmen's
[Connecting to an operator's gateways](../README.md#connecting-to-an-operators-gateways)
wherever Fulmen does not run, or for anyone who prefers a terminal: a SeqLN
node for the assets on Sequentia and a Core Lightning node for BTC on Bitcoin
testnet4, driven with `lightning-cli`. With them you open channels to an Ark
operator's gateways, pay into the operator's tree and are paid out of it.

The examples connect to the Sequentia testnet's operator at
`sequentiatestnet.com`. Another operator works the same way at its own address.

## The nodes

- **SeqLN**, for assets on Sequentia: build it from
  [`seqln`](https://github.com/ConcatenaLabs/seqln) (branch
  `sequentia-stable`; its README has the build steps). SeqLN also runs on
  Bitcoin networks, so one build serves both sides.
- **Core Lightning**, for BTC on Bitcoin testnet4: a stock release from
  [Core Lightning](https://github.com/ElementsProject/lightning), or SeqLN.
- **As containers**: the operator bundle runs SeqLN and Core Lightning from
  one compose file; see arca's
  [`doc/operator-bundle.md`](https://github.com/ConcatenaLabs/arca/blob/master/doc/operator-bundle.md).
  Inside a container, run each `lightning-cli` command below with
  `docker compose exec <service> lightning-cli …`.

Each node reads its chain through a node's RPC: a Sequentia node
(`sequentiad`; port `18884` in the operator bundle) and a Bitcoin testnet4 node
(`bitcoind`; port `48332`). Give each its own directory and config file, so the
RPC password stays out of the command line. A wallet node needs no inbound
connections, so it does not listen:

`~/.seqln/config`

```
network=sequentia-testnet
bitcoin-rpcconnect=127.0.0.1
bitcoin-rpcport=18884
bitcoin-rpcuser=<RPC user of the Sequentia node>
bitcoin-rpcpassword=<RPC password of the Sequentia node>
bitcoin-cli=/path/to/sequentia-cli
autolisten=false
```

`~/.cln-testnet4/config`

```
network=testnet4
bitcoin-rpcconnect=127.0.0.1
bitcoin-rpcport=48332
bitcoin-rpcuser=<RPC user of the Bitcoin node>
bitcoin-rpcpassword=<RPC password of the Bitcoin node>
autolisten=false
```

Start each with `lightningd --lightning-dir=<its directory>`. Below, `seq` is
`lightning-cli --lightning-dir=$HOME/.seqln` and `btc` is
`lightning-cli --lightning-dir=$HOME/.cln-testnet4`:

```
alias seq="lightning-cli --lightning-dir=$HOME/.seqln"
alias btc="lightning-cli --lightning-dir=$HOME/.cln-testnet4"
```

## 1. Find the gateways

```
curl -s https://sequentiatestnet.com/arca/v1/info
```

For each asset in `assets[]` whose `lightning.state` is `up`,
`lightning.node` is that asset's SeqLN gateway; it takes peers at
`sequentiatestnet.com:19850`. `lightning.bitcoin.node.node` is the Bitcoin
ark's gateway; it takes peers at `sequentiatestnet.com:19746`.

## 2. Open the channels

On Sequentia, one channel for each asset, funded with coins of that asset:

```
seq newaddr                          # send coins of the asset here, a little more than the channel
seq listfunds                        # wait until they show "confirmed"
seq connect <gateway id>@sequentiatestnet.com:19850
seq fundchannel id=<gateway id> amount=<atoms> asset=<asset id>
seq listpeerchannels                 # CHANNELD_NORMAL once the funding is in a block
```

The funding transaction pays its network fee in the channel's asset.

On Bitcoin testnet4:

```
btc newaddr                          # send BTC here
btc connect <gateway id>@sequentiatestnet.com:19746
btc fundchannel id=<gateway id> amount=<sats>
```

Each side of a channel keeps a reserve of 1% of it that it cannot send. The
gateway can pay you once its side holds more than that, which it does once you
have paid into the tree.

## 3. Pay into an Ark

Ask the receiving wallet for an invoice (`arca lightning receive <asset id>
<atoms>` for an asset, `arca lightning receive btc <sats>` for BTC). Read the
invoice first:

```
seq decode <invoice>
```

`asset` is the asset it is paid in, and `min_final_cltv_expiry` the blocks the
last hop's payment is locked for. An operator's invoice for a payment into its
tree asks for a long lock, about 5,800 Sequentia blocks (four days) with the
usual 36-hour exit delay, because the operator holds the payment until the
receiving wallet has taken its coin in the operator's next round. Allow the
pay call that lock and room for a few hops (270 blocks a hop on Sequentia):

```
seq pay bolt11=<invoice> maxdelay=<min_final_cltv_expiry + 810>
```

That is also how long the amount can stay locked if the payment cannot
complete. The call returns once the wallet takes its coin; meanwhile
`seq listpays bolt11=<invoice>` shows it `pending`, and it settles or comes
back by itself.

On Bitcoin, pay a Bitcoin ark wallet's invoice while the wallet claims it
(`arca lightning claim <invoice>`):

```
btc pay <invoice>
```

## 4. Receive out of an Ark

An Arca wallet pays an invoice only from its coins in the asset the invoice
names, so name it:

```
seq invoice amount_msat=<atoms × 1000> label=<a label> description=<text> asset=<asset id>
```

The wallet pays it with `arca lightning pay <invoice>`. On Bitcoin an invoice
names no asset:

```
btc invoice amount_msat=<sats × 1000> label=<a label> description=<text>
```

## 5. Close

```
seq close <gateway id>
seq withdraw <address> all asset=<asset id>
btc close <gateway id>
btc withdraw <address> all
```

## Generic Core Lightning interfaces

A web interface for Core Lightning, such as Ride The Lightning over the
`clnrest` plugin and a rune, shows the channels, payments and invoices of a
SeqLN node, and drives the BTC node in full. It knows nothing of SeqLN's
assets: it shows no channel's asset, no balance by asset and no invoice's
asset, reads every amount as satoshis, and has no field for the `asset` that
opening a channel and making an invoice on Sequentia take. Use `lightning-cli`
or Fulmen for those.
