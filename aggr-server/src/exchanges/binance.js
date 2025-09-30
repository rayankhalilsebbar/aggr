const Exchange = require('../exchange')
const { sleep, getHms } = require('../helper')
const axios = require('axios')

class Binance extends Exchange {
  constructor() {
    super()

    this.id = 'BINANCE'
    this.lastSubscriptionId = 0
    this.maxConnectionsPerApi = 16
    this.subscriptions = {}
    this.orderBookActive = new Set()

    this.endpoints = {
      PRODUCTS: 'https://data-api.binance.vision/api/v3/exchangeInfo'
    }

    this.url = () => `wss://data-stream.binance.vision:9443/ws`
  }

  formatProducts(data) {
    return data.symbols.map(a => a.symbol.toLowerCase())
  }

  /**
   * Sub
   * @param {WebSocket} api
   * @param {string} pair
   */
  async subscribe(api, pair) {
    if (!(await super.subscribe.apply(this, arguments))) {
      return
    }

    this.subscriptions[pair] = ++this.lastSubscriptionId

    const params = [pair + '@trade']

    api.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params,
        id: this.subscriptions[pair]
      })
    )

    // this websocket api have a limit of about 5 messages per second.
    await sleep(250 * this.apis.length)
  }

  /**
   * Unsub
   * @param {WebSocket} api
   * @param {string} pair
   */
  async unsubscribe(api, pair) {
    if (!(await super.unsubscribe.apply(this, arguments))) {
      return
    }

    const params = [pair + '@trade']

    api.send(
      JSON.stringify({
        method: 'UNSUBSCRIBE',
        params,
        id: this.subscriptions[pair]
      })
    )

    delete this.subscriptions[pair]

    // this websocket api have a limit of about 5 messages per second.
    await sleep(250 * this.apis.length)
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    // Handle trades
    if (json.E && json.e === 'trade') {
      return this.emitTrades(api.id, [
        this.formatTrade(json, json.s.toLowerCase())
      ])
    }

    // Handle order book updates  
    if (json.e === 'depthUpdate') {
      this.handleDepthUpdateDirect(json)
    }
  }

  formatTrade(trade, symbol) {
    return {
      exchange: this.id,
      pair: symbol,
      timestamp: trade.E,
      price: +trade.p,
      size: +trade.q,
      side: trade.m ? 'sell' : 'buy'
    }
  }

  getMissingTrades(range, totalRecovered = 0) {
    const startTime = range.from
    const below1HEndTime = Math.min(range.to, startTime + 1000 * 60 * 60)

    const endpoint = `https://data-api.binance.vision/api/v3/aggTrades?symbol=${range.pair.toUpperCase()}&startTime=${
      startTime + 1
    }&endTime=${below1HEndTime}&limit=1000`

    return axios
      .get(endpoint)
      .then(response => {
        if (response.data.length) {
          const trades = response.data.map(trade => ({
            ...this.formatTrade(trade, range.pair),
            count: trade.l - trade.f + 1,
            timestamp: trade.T
          }))

          this.emitTrades(null, trades)

          totalRecovered += trades.length
          range.from = trades[trades.length - 1].timestamp

          const remainingMissingTime = range.to - range.from

          if (remainingMissingTime > 1000) {
            console.log(
              `[${this.id}.recoverMissingTrades] +${trades.length} ${
                range.pair
              } ... (${getHms(remainingMissingTime)} remaining)`
            )
            return this.waitBeforeContinueRecovery().then(() =>
              this.getMissingTrades(range, totalRecovered)
            )
          } else {
            console.log(
              `[${this.id}.recoverMissingTrades] +${trades.length} ${
                range.pair
              } (${getHms(remainingMissingTime)} remaining)`
            )
          }
        }

        return totalRecovered
      })
      .catch(err => {
        console.error(
          `Failed to get historical trades on ${range.pair}`,
          err.message
        )
      })
  }

  formatOrderBook(data, pair) {
    return {
      exchange: this.id,
      pair: pair.toLowerCase(),
      timestamp: Date.now(),
      lastUpdateId: data.lastUpdateId,
      bids: data.bids.map(([price, size]) => ({
        price: +price,
        size: +size
      })),
      asks: data.asks.map(([price, size]) => ({
        price: +price, 
        size: +size 
      }))
    }
  }

  async fetchOrderBook(pair) {
    const url = `https://api.binance.com/api/v3/depth?symbol=${pair.toUpperCase()}&limit=100`
    
    try {
      console.log(`[${this.id}] Fetching initial snapshot for ${pair.toUpperCase()}`)
      const response = await axios.get(url)
      const orderBook = this.formatOrderBook(response.data, pair)
      console.log(`[${this.id}] Snapshot ${pair.toUpperCase()}: ${orderBook.bids.length} bids, ${orderBook.asks.length} asks`)
      return orderBook
    } catch (error) {
      console.error(`[${this.id}] Failed to fetch order book for ${pair}:`, error.message)
      throw error
    }
  }

  async initializeOrderBook(pair) {
    try {
      console.log(`[${this.id}] Initializing order book for ${pair.toUpperCase()}`)
      
      // Récupérer le snapshot initial
      const initialOrderBook = await this.fetchOrderBook(pair)
      
      // Stocker dans InfluxDB
      if (this.influxStorage && this.influxStorage.writeOrderBook) {
        await this.influxStorage.writeOrderBook(initialOrderBook)
        console.log(`[${this.id}] Stored initial order book for ${pair.toUpperCase()}`)
      }
      
      // Marquer comme actif
      this.orderBookActive.add(pair.toLowerCase())
      
      // S'abonner aux mises à jour WebSocket
      if (this.apis && this.apis.length > 0) {
        const ws = this.apis[0]
        const subscribeMessage = {
          method: 'SUBSCRIBE',
          params: [`${pair.toLowerCase()}@depth@100ms`],
          id: Date.now()
        }
        
        ws.send(JSON.stringify(subscribeMessage))
        console.log(`[${this.id}] Subscribed to ${pair.toUpperCase()}@depth@100ms`)
      }
      
    } catch (error) {
      console.error(`[${this.id}] Failed to initialize order book for ${pair}:`, error)
    }
  }

  async handleDepthUpdateDirect(data) {
    const pair = data.s.toLowerCase()
    
    if (!this.orderBookActive.has(pair)) {
      return
    }
    
    // Filtrer les ordres avec size = 0 (suppression)
    const validBids = data.b.filter(([price, size]) => parseFloat(size) > 0)
    const validAsks = data.a.filter(([price, size]) => parseFloat(size) > 0)
    
    if (validBids.length === 0 && validAsks.length === 0) {
      return
    }
    
    const orderBookUpdate = {
      exchange: this.id,
      pair: pair,
      timestamp: Date.now(),
      bids: validBids.map(([price, size]) => ({
        price: parseFloat(price),
        size: parseFloat(size)
      })),
      asks: validAsks.map(([price, size]) => ({
        price: parseFloat(price),
        size: parseFloat(size)
      }))
    }
    
    // Stocker dans InfluxDB
    if (this.influxStorage && this.influxStorage.writeOrderBook) {
      try {
        await this.influxStorage.writeOrderBook(orderBookUpdate)
      } catch (error) {
        console.error(`[${this.id}] Failed to store order book update:`, error)
      }
    }
  }
}

module.exports = Binance
