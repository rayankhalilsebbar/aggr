const Influx = require('influx')
const { getHms, sleep, ID, ago } = require('../helper')
const net = require('net')
const config = require('../config')
const socketService = require('../services/socket')
const alertService = require('../services/alert')
const { updateIndexes } = require('../services/connections')
const { parseMarket } = require('../services/catalog')

require('../typedef')

const DAY = 1000 * 60 * 60 * 24

class InfluxStorage {
  constructor() {
    this.name = this.constructor.name
    this.format = 'point'

    /**
     * @type {{[pendingBarsRequestId: string]: (bars: Bar[]) => void}}
     */
    this.promisesOfPendingBars = {}

    /**
     * @type {{[identifier: string]: Bar[]}}
     */
    this.recentlyClosedBars = {}

    /**
     * @type {{[identifier: string]: {[timestamp: number]: Bar}}}
     */
    this.pendingBars = {}

    /**
     * @type {{[identifier: string]: {[timestamp: number]: Bar}}}
     */
    this.archivedBars = {}

    /**
     * @type {number}
     */
    this.influxTimeframeRetentionDuration = null
  }

  async connect() {
    if (/\-/.test(config.influxDatabase)) {
      throw new Error('dashes not allowed inside influxdb database')
    }

    let host = config.influxHost
    let port = config.influxPort

    if (typeof config.influxUrl === 'string' && config.influxUrl.length) {
      ;[host, port] = config.influxUrl.split(':')
    }

    console.log(
      `[storage/influx] connecting to ${host}:${port} on db "${config.influxDatabase}"`
    )

    try {
      this.influx = new Influx.InfluxDB({
        host: host || 'localhost',
        port: port || '8086',
        database: config.influxDatabase,
        schema: [
          {
            measurement: 'orderbook',
            fields: {
              price: Influx.FieldType.FLOAT,
              size: Influx.FieldType.FLOAT
            },
            tags: ['market', 'side']
          },
          {
            measurement: 'liquidity_sums',
            fields: {
              bid_sum_total: Influx.FieldType.FLOAT,
              ask_sum_total: Influx.FieldType.FLOAT,
              mid_price: Influx.FieldType.FLOAT,
              // 60 niveaux de profondeur pour bids (0.5% à 30% par 0.5%)
              bid_sum_0_5pct: Influx.FieldType.FLOAT,
              bid_sum_1pct: Influx.FieldType.FLOAT,
              bid_sum_1_5pct: Influx.FieldType.FLOAT,
              bid_sum_2pct: Influx.FieldType.FLOAT,
              bid_sum_2_5pct: Influx.FieldType.FLOAT,
              bid_sum_3pct: Influx.FieldType.FLOAT,
              bid_sum_3_5pct: Influx.FieldType.FLOAT,
              bid_sum_4pct: Influx.FieldType.FLOAT,
              bid_sum_4_5pct: Influx.FieldType.FLOAT,
              bid_sum_5pct: Influx.FieldType.FLOAT,
              bid_sum_5_5pct: Influx.FieldType.FLOAT,
              bid_sum_6pct: Influx.FieldType.FLOAT,
              bid_sum_6_5pct: Influx.FieldType.FLOAT,
              bid_sum_7pct: Influx.FieldType.FLOAT,
              bid_sum_7_5pct: Influx.FieldType.FLOAT,
              bid_sum_8pct: Influx.FieldType.FLOAT,
              bid_sum_8_5pct: Influx.FieldType.FLOAT,
              bid_sum_9pct: Influx.FieldType.FLOAT,
              bid_sum_9_5pct: Influx.FieldType.FLOAT,
              bid_sum_10pct: Influx.FieldType.FLOAT,
              bid_sum_10_5pct: Influx.FieldType.FLOAT,
              bid_sum_11pct: Influx.FieldType.FLOAT,
              bid_sum_11_5pct: Influx.FieldType.FLOAT,
              bid_sum_12pct: Influx.FieldType.FLOAT,
              bid_sum_12_5pct: Influx.FieldType.FLOAT,
              bid_sum_13pct: Influx.FieldType.FLOAT,
              bid_sum_13_5pct: Influx.FieldType.FLOAT,
              bid_sum_14pct: Influx.FieldType.FLOAT,
              bid_sum_14_5pct: Influx.FieldType.FLOAT,
              bid_sum_15pct: Influx.FieldType.FLOAT,
              bid_sum_15_5pct: Influx.FieldType.FLOAT,
              bid_sum_16pct: Influx.FieldType.FLOAT,
              bid_sum_16_5pct: Influx.FieldType.FLOAT,
              bid_sum_17pct: Influx.FieldType.FLOAT,
              bid_sum_17_5pct: Influx.FieldType.FLOAT,
              bid_sum_18pct: Influx.FieldType.FLOAT,
              bid_sum_18_5pct: Influx.FieldType.FLOAT,
              bid_sum_19pct: Influx.FieldType.FLOAT,
              bid_sum_19_5pct: Influx.FieldType.FLOAT,
              bid_sum_20pct: Influx.FieldType.FLOAT,
              bid_sum_20_5pct: Influx.FieldType.FLOAT,
              bid_sum_21pct: Influx.FieldType.FLOAT,
              bid_sum_21_5pct: Influx.FieldType.FLOAT,
              bid_sum_22pct: Influx.FieldType.FLOAT,
              bid_sum_22_5pct: Influx.FieldType.FLOAT,
              bid_sum_23pct: Influx.FieldType.FLOAT,
              bid_sum_23_5pct: Influx.FieldType.FLOAT,
              bid_sum_24pct: Influx.FieldType.FLOAT,
              bid_sum_24_5pct: Influx.FieldType.FLOAT,
              bid_sum_25pct: Influx.FieldType.FLOAT,
              bid_sum_25_5pct: Influx.FieldType.FLOAT,
              bid_sum_26pct: Influx.FieldType.FLOAT,
              bid_sum_26_5pct: Influx.FieldType.FLOAT,
              bid_sum_27pct: Influx.FieldType.FLOAT,
              bid_sum_27_5pct: Influx.FieldType.FLOAT,
              bid_sum_28pct: Influx.FieldType.FLOAT,
              bid_sum_28_5pct: Influx.FieldType.FLOAT,
              bid_sum_29pct: Influx.FieldType.FLOAT,
              bid_sum_29_5pct: Influx.FieldType.FLOAT,
              bid_sum_30pct: Influx.FieldType.FLOAT,
              // 60 niveaux de profondeur pour asks (0.5% à 30% par 0.5%)
              ask_sum_0_5pct: Influx.FieldType.FLOAT,
              ask_sum_1pct: Influx.FieldType.FLOAT,
              ask_sum_1_5pct: Influx.FieldType.FLOAT,
              ask_sum_2pct: Influx.FieldType.FLOAT,
              ask_sum_2_5pct: Influx.FieldType.FLOAT,
              ask_sum_3pct: Influx.FieldType.FLOAT,
              ask_sum_3_5pct: Influx.FieldType.FLOAT,
              ask_sum_4pct: Influx.FieldType.FLOAT,
              ask_sum_4_5pct: Influx.FieldType.FLOAT,
              ask_sum_5pct: Influx.FieldType.FLOAT,
              ask_sum_5_5pct: Influx.FieldType.FLOAT,
              ask_sum_6pct: Influx.FieldType.FLOAT,
              ask_sum_6_5pct: Influx.FieldType.FLOAT,
              ask_sum_7pct: Influx.FieldType.FLOAT,
              ask_sum_7_5pct: Influx.FieldType.FLOAT,
              ask_sum_8pct: Influx.FieldType.FLOAT,
              ask_sum_8_5pct: Influx.FieldType.FLOAT,
              ask_sum_9pct: Influx.FieldType.FLOAT,
              ask_sum_9_5pct: Influx.FieldType.FLOAT,
              ask_sum_10pct: Influx.FieldType.FLOAT,
              ask_sum_10_5pct: Influx.FieldType.FLOAT,
              ask_sum_11pct: Influx.FieldType.FLOAT,
              ask_sum_11_5pct: Influx.FieldType.FLOAT,
              ask_sum_12pct: Influx.FieldType.FLOAT,
              ask_sum_12_5pct: Influx.FieldType.FLOAT,
              ask_sum_13pct: Influx.FieldType.FLOAT,
              ask_sum_13_5pct: Influx.FieldType.FLOAT,
              ask_sum_14pct: Influx.FieldType.FLOAT,
              ask_sum_14_5pct: Influx.FieldType.FLOAT,
              ask_sum_15pct: Influx.FieldType.FLOAT,
              ask_sum_15_5pct: Influx.FieldType.FLOAT,
              ask_sum_16pct: Influx.FieldType.FLOAT,
              ask_sum_16_5pct: Influx.FieldType.FLOAT,
              ask_sum_17pct: Influx.FieldType.FLOAT,
              ask_sum_17_5pct: Influx.FieldType.FLOAT,
              ask_sum_18pct: Influx.FieldType.FLOAT,
              ask_sum_18_5pct: Influx.FieldType.FLOAT,
              ask_sum_19pct: Influx.FieldType.FLOAT,
              ask_sum_19_5pct: Influx.FieldType.FLOAT,
              ask_sum_20pct: Influx.FieldType.FLOAT,
              ask_sum_20_5pct: Influx.FieldType.FLOAT,
              ask_sum_21pct: Influx.FieldType.FLOAT,
              ask_sum_21_5pct: Influx.FieldType.FLOAT,
              ask_sum_22pct: Influx.FieldType.FLOAT,
              ask_sum_22_5pct: Influx.FieldType.FLOAT,
              ask_sum_23pct: Influx.FieldType.FLOAT,
              ask_sum_23_5pct: Influx.FieldType.FLOAT,
              ask_sum_24pct: Influx.FieldType.FLOAT,
              ask_sum_24_5pct: Influx.FieldType.FLOAT,
              ask_sum_25pct: Influx.FieldType.FLOAT,
              ask_sum_25_5pct: Influx.FieldType.FLOAT,
              ask_sum_26pct: Influx.FieldType.FLOAT,
              ask_sum_26_5pct: Influx.FieldType.FLOAT,
              ask_sum_27pct: Influx.FieldType.FLOAT,
              ask_sum_27_5pct: Influx.FieldType.FLOAT,
              ask_sum_28pct: Influx.FieldType.FLOAT,
              ask_sum_28_5pct: Influx.FieldType.FLOAT,
              ask_sum_29pct: Influx.FieldType.FLOAT,
              ask_sum_29_5pct: Influx.FieldType.FLOAT,
              ask_sum_30pct: Influx.FieldType.FLOAT
            },
            tags: ['exchange', 'pair']
          }
        ]
      })

      const databases = await this.influx.getDatabaseNames()

      if (!databases.includes(config.influxDatabase)) {
        await this.influx.createDatabase(config.influxDatabase)
      }

      if (config.collect) {
        await this.ensureRetentionPolicies()

        if (config.pairs.length) {
          await this.getPreviousBars()
        }
      }
    } catch (error) {
      console.error(
        [
          `[storage/influx] Error: ${error.message}... retrying in 1s`,
          `Please ensure that the environment variable INFLUX_HOST is correctly set or that InfluxDB is running.`,
          `Refer to the README.md file for more instructions.`
        ].join('\n')
      )

      await sleep()

      return this.connect()
    } finally {
      if (config.influxCollectors) {
        if (config.api) {
          this.bindCollectorsEvents()
        } else if (config.collect) {
          this.bindClusterEvents()
        }

        if (config.api && !config.collect) {
          // schedule import of all collectors every influxResampleInterval until the scripts die
          setTimeout(
            this.importCollectors.bind(this),
            config.influxResampleInterval
          )
        }
      }

      if (alertService) {
        this.bindAlertsEvents()
      }
    }
  }

  /**
   * listen for responses from collector node
   */
  bindCollectorsEvents() {
    socketService
      .on('import', () => {
        // response from import request

        if (this.promiseOfImport) {
          this.promiseOfImport() // trigger next import (if any)
        }
      })
      .on('requestPendingBars', ({ data }) => {
        // response from pending bars request

        if (this.promisesOfPendingBars[data.pendingBarsRequestId]) {
          this.promisesOfPendingBars[data.pendingBarsRequestId](data.results)
        } else {
          // console.error('[influx/cluster] there was no promisesOfPendingBars with given pendingBarsRequestId', data.pendingBarsRequestId)
        }
      })
  }

  /**
   * listen for request from cluster node
   */
  bindClusterEvents() {
    socketService
      .on('requestPendingBars', ({ data }) => {
        // this is a request for pending bars from cluster
        const payload = {
          pendingBarsRequestId: data.pendingBarsRequestId,
          results: this.getPendingBars(data.markets, data.from, data.to)
        }
        socketService.clusterSocket.write(
          JSON.stringify({
            opId: 'requestPendingBars',
            data: payload
          }) + '#'
        )
      })
      .on('import', () => {
        // this is a request to import pending data

        this.import().finally(() => {
          if (socketService.clusterSocket) {
            socketService.clusterSocket.write(
              JSON.stringify({
                opId: 'import'
              }) + '#'
            )
          }
        })
      })
  }

  /**
   * Listen for alerts change
   */
  bindAlertsEvents() {
    alertService.on(
      'change',
      ({ market, price, user, type, previousPrice }) => {
        const fields = {
          price,
          user,
          type
        }

        if (typeof previousPrice !== 'undefined') {
          fields.previousPrice = previousPrice
        }

        this.writePoints(
          [
            {
              measurement: 'alerts',
              tags: {
                market
              },
              fields,
              timestamp: Date.now()
            }
          ],
          {
            precision: 'ms'
          }
        )
      }
    )
  }

  /**
   *
   */
  async ensureRetentionPolicies() {
    const retentionsPolicies = (
      await this.influx.showRetentionPolicies()
    ).reduce((output, retentionPolicy) => {
      output[retentionPolicy.name] = retentionPolicy.duration
      return output
    }, {})

    const timeframes = [config.influxTimeframe].concat(config.influxResampleTo)
    this.influxTimeframeRetentionDuration =
      config.influxTimeframe * config.influxRetentionPerTimeframe

    for (let timeframe of timeframes) {
      const rpDuration = timeframe * config.influxRetentionPerTimeframe
      const rpDurationLitteral = getHms(rpDuration).replace(/[\s,]/g, '')
      const rpName = config.influxRetentionPrefix + getHms(timeframe)

      if (!retentionsPolicies[rpName]) {
        console.log(
          `[storage/influx] create retention policy ${rpName} (duration ${rpDurationLitteral})`
        )
        await this.influx.createRetentionPolicy(rpName, {
          database: config.influxDatabase,
          duration: rpDurationLitteral,
          replication: 1
        })
      }

      delete retentionsPolicies[rpName]
    }

    for (let rpName in retentionsPolicies) {
      if (rpName.indexOf(config.influxRetentionPrefix) === 0) {
        console.warn(`[storage/influx] unused retention policy ? (${rpName})`)
        // await this.influx.dropRetentionPolicy(rpName, config.influxDatabase)
        // just warning now because of multiple instances of aggr-server running with different RPs
      }
    }

    this.baseRp = config.influxRetentionPrefix + getHms(config.influxTimeframe)
  }

  getPreviousBars() {
    const timeframeLitteral = getHms(config.influxTimeframe)
    const now = +new Date()

    let query = `SELECT * FROM ${
      config.influxRetentionPrefix
    }${timeframeLitteral}.${config.influxMeasurement}${'_' + timeframeLitteral}`

    query += ` WHERE (${config.pairs
      .map(market => `market = '${market}'`)
      .join(' OR ')})`

    query += `GROUP BY "market" ORDER BY time DESC LIMIT 1`

    this.influx.query(query).then(data => {
      for (let bar of data) {
        if (now - bar.time > config.influxResampleInterval) {
          // can't use lastBar because it is too old anyway
          continue
        }

        let originalBar

        if (!this.pendingBars[bar.market]) {
          this.pendingBars[bar.market] = {}
        }

        if (
          this.pendingBars[bar.market] &&
          (originalBar = this.pendingBars[bar.market][+bar.time])
        ) {
          this.sumBar(originalBar, bar)
        } else {
          this.pendingBars[bar.market][+bar.time] = this.sumBar({}, bar)
        }
      }
    })
  }

  sumBar(barToMutate, barToAdd) {
    const props = Object.keys(barToMutate)
      .concat(Object.keys(barToAdd))
      .filter((x, i, a) => a.indexOf(x) == i)

    for (let i = 0; i < props.length; i++) {
      const prop = props[i]

      const value = isNaN(barToAdd[prop]) ? barToAdd[prop] : +barToAdd[prop]

      if (typeof barToMutate[prop] === 'undefined') {
        barToMutate[prop] = value
        continue
      }

      if (typeof barToMutate[prop] === 'number') {
        barToMutate[props] += value
      }
    }

    if (
      !barToMutate.open &&
      !barToMutate.high &&
      !barToMutate.low &&
      !barToMutate.close
    ) {
      barToMutate.open =
        barToMutate.high =
        barToMutate.low =
        barToMutate.close =
          null
    }

    return barToMutate
  }

  /**
   * Process the trades into bars of minimum tf
   * And occasionaly writes into db
   * Triggered every options.backupInterval
   *
   * @param {Trade[]} trades
   * @param {boolean} isExiting
   * @returns
   */
  async save(trades, isExiting) {
    if (!trades || !trades.length) {
      return Promise.resolve()
    }

    // convert the trades into bars (bars tf = minimum tf)
    this.processTrades(trades)

    if (isExiting) {
      // always write when exiting
      return this.import()
    }

    if (!socketService.clusterSocket) {
      // here the cluster node decide when to write in db
      // otherwise cluster will send a command for that (to balance write tasks between collectors nodes)

      const now = Date.now()
      const timeBackupFloored =
        Math.floor(now / config.backupInterval) * config.backupInterval
      const timeMinuteFloored =
        Math.floor(now / config.influxResampleInterval) *
        config.influxResampleInterval

      if (timeBackupFloored === timeMinuteFloored) {
        return this.import()
      }
    }
  }

  /**
   * Trades into bars (pending bars)
   *
   * @param {Trade[]} trades
   * @returns {Promise<{
      from: number,
      to: number,
      markets: string[],
    }>}
   * @memberof InfluxStorage
   */
  async processTrades(trades) {
    /**
     * Current bars
     * @type {{[identifier: string]: Bar}}
     */
    const bars = {}

    /**
     * Processed ranges by market
     * @type {{[identifier: string]: {
     *  high: number,
     *  low: number
     * }}}
     */
    const ranges = {}

    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i]
      const market = trade.exchange + ':' + trade.pair
      const tradeFlooredTime =
        Math.floor(trade.timestamp / config.influxTimeframe) *
        config.influxTimeframe

      if (!trade.liquidation) {
        if (!ranges[market]) {
          ranges[market] = {
            low: trade.price,
            high: trade.price,
            close: trade.price
          }
        } else {
          ranges[market].low = Math.min(ranges[market].low, trade.price)
          ranges[market].high = Math.max(ranges[market].high, trade.price)
          ranges[market].close = trade.price
        }
      }

      if (!bars[market] || bars[market].time !== tradeFlooredTime) {
        //bars[market] && console.log(`${market} time is !==, resolve bar or create`)
        // need to create bar OR recover bar either from pending bar / last saved bar

        if (!this.pendingBars[market]) {
          //console.log(`create container for pending bars of market ${market}`)
          this.pendingBars[market] = {}
        }

        if (
          this.pendingBars[market] &&
          this.pendingBars[market][tradeFlooredTime]
        ) {
          bars[market] = this.pendingBars[market][tradeFlooredTime]
        } else if (
          this.archivedBars[market] &&
          this.archivedBars[market][tradeFlooredTime]
        ) {
          bars[market] = this.pendingBars[market][tradeFlooredTime] =
            this.archivedBars[market][tradeFlooredTime]
        } else {
          bars[market] = this.pendingBars[market][tradeFlooredTime] = {
            time: tradeFlooredTime,
            market: market,
            cbuy: 0,
            csell: 0,
            vbuy: 0,
            vsell: 0,
            lbuy: 0,
            lsell: 0,
            open: null,
            high: null,
            low: null,
            close: null
          }
          //console.log(`\tcreate new bar (time ${new Date(bars[market].time).toISOString().split('T').pop().replace(/\..*/, '')})`)
        }
      }

      if (trade.liquidation) {
        // trade is a liquidation
        bars[market]['l' + trade.side] += trade.price * trade.size
      } else {
        if (bars[market].open === null) {
          bars[market].open =
            bars[market].high =
            bars[market].low =
            bars[market].close =
              +trade.price
        } else {
          bars[market].high = Math.max(bars[market].high, +trade.price)
          bars[market].low = Math.min(bars[market].low, +trade.price)
          bars[market].close = +trade.price
        }

        bars[market]['c' + trade.side] += trade.count || 1
        bars[market]['v' + trade.side] += trade.price * trade.size
      }
    }

    await updateIndexes(ranges, async (index, high, low, direction) => {
      await alertService.checkPriceCrossover(index, high, low, direction)
    })
  }

  /**
   * Import pending bars (minimum tf bars) and resample into bigger timeframes
   */
  async import() {
    const resampleRange = await this.importPendingBars()

    if (resampleRange.to - resampleRange.from >= 0) {
      await this.resample(resampleRange)
    }

    this.cleanArchivedBars()
  }

  cleanArchivedBars() {
    const limit = Date.now() - config.influxTimeframe * 100
    for (const identifier in this.archivedBars) {
      for (const timestamp in this.archivedBars[identifier]) {
        if (Number(timestamp) < limit) {
          delete this.archivedBars[identifier][timestamp]
          continue
        }
      }
    }
  }

  /**
   * Import and clear pending bars
   *
   * @returns {Promise<{
      from: number,
      to: number,
      markets: string[],
    }>}
   * @memberof InfluxStorage
   */
  async importPendingBars() {
    const now = Date.now()

    /**
     * closed bars
     * @type {Bar[]}
     */
    const barsToImport = []

    /**
     * Total range of import
     * @type {TimeRange}
     */
    const importedRange = {
      from: Infinity,
      to: 0,
      markets: []
    }

    for (const identifier in this.pendingBars) {
      if (importedRange.markets.indexOf(identifier) === -1) {
        importedRange.markets.push(identifier)
      }

      for (const timestamp in this.pendingBars[identifier]) {
        if (timestamp < now - this.influxTimeframeRetentionDuration) {
          continue
        }

        const bar = this.pendingBars[identifier][timestamp]

        importedRange.from = Math.min(bar.time, importedRange.from)
        importedRange.to = Math.max(bar.time, importedRange.to)

        barsToImport.push(bar)

        if (!this.archivedBars[identifier]) {
          this.archivedBars[identifier] = {}
        }

        this.archivedBars[identifier][timestamp] =
          this.pendingBars[identifier][timestamp]
      }
    }

    // free up pending bars memory
    this.pendingBars = {}

    if (barsToImport.length) {
      // console.log(`[storage/influx] importing ${barsToImport.length} bars`)

      await this.writePoints(
        barsToImport.map(bar => {
          const fields = {}

          if (bar.vbuy || bar.vsell) {
            fields.vbuy = bar.vbuy
            fields.vsell = bar.vsell
            fields.cbuy = bar.cbuy
            fields.csell = bar.csell
          }

          if (bar.lbuy || bar.lsell) {
            fields.lbuy = bar.lbuy
            fields.lsell = bar.lsell
          }

          if (bar.close !== null) {
            ;(fields.open = bar.open),
              (fields.high = bar.high),
              (fields.low = bar.low),
              (fields.close = bar.close)
          }

          return {
            measurement: 'trades_' + getHms(config.influxTimeframe),
            tags: {
              market: bar.market
            },
            fields: fields,
            timestamp: +bar.time
          }
        }),
        {
          precision: 'ms',
          retentionPolicy: this.baseRp
        }
      )
    }

    return importedRange
  }

  /**
   * Wrapper for write
   * Write points into db
   * Called from importPendingBars
   *
   * @param {Influx.IPoint[]} points
   * @param {Influx.IWriteOptions} options
   * @param {number?} attempt no of attempt starting at 0 (abort if too much failed attempts)
   * @returns
   */
  async writePoints(points, options, attempt = 0) {
    if (!points.length) {
      return
    }

    const measurement = points[0].measurement
    const from = points[0].timestamp
    const to = points[points.length - 1].timestamp

    try {
      await this.influx.writePoints(points, options)

      if (attempt > 0) {
        console.log(
          `[storage/influx] successfully wrote points after ${attempt} attempt(s)`
        )
      }
    } catch (error) {
      attempt++

      console.error(
        `[storage/influx] write points failed (${attempt}${
          attempt === 1
            ? 'st'
            : attempt === 2
            ? 'nd'
            : attempt === 3
            ? 'rd'
            : 'th'
        } attempt)`,
        error.message
      )

      if (attempt >= 5) {
        console.error(
          `too many attemps at writing points\n\n${measurement}, ${new Date(
            from
          ).toUTCString()} to ${new Date(to).toUTCString()}\n\t-> abort`
        )
        throw error.message
      }

      await sleep(500)

      return this.writePoints(points, options, attempt)
    }
  }

  /**
   * Start from minimum tf (influxTimeframe) and update all timeframes above it (influxResampleTo)
   * 10s into 30s, 30s into 1m, 1m into 3m, 1m into 5m, 5m into 15m, 3m into 21m, 15m into 30m etc
   *
   * @memberof InfluxStorage
   */
  async resample(range, fromTimeframe, toTimeframe = null) {
    let sourceTimeframeLitteral
    let destinationTimeframeLitteral

    let now = Date.now()
    let before = now

    console.log(
      `[storage/influx/resample] resampling ${range.markets.length} markets`
    )

    let minimumTimeframe
    let timeframes
    if (fromTimeframe) {
      minimumTimeframe = Math.max(fromTimeframe, config.influxTimeframe)
      timeframes = config.influxResampleTo.filter(a => a > fromTimeframe)
    } else {
      minimumTimeframe = config.influxTimeframe
      timeframes = config.influxResampleTo
    }

    let bars = 0

    for (let timeframe of timeframes) {
      const isOddTimeframe = DAY % timeframe !== 0 && timeframe < DAY

      if (toTimeframe && timeframe !== toTimeframe) {
        continue
      }

      let flooredRange

      if (isOddTimeframe) {
        const dayOpen = Math.floor(range.from / DAY) * DAY
        flooredRange = {
          from:
            dayOpen +
            Math.floor((range.from - dayOpen) / timeframe) * timeframe,
          to:
            dayOpen +
            Math.floor((range.to - dayOpen) / timeframe) * timeframe +
            timeframe
        }
      } else {
        flooredRange = {
          from: Math.floor(range.from / timeframe) * timeframe,
          to: Math.floor(range.to / timeframe) * timeframe + timeframe
        }
      }

      for (let i = timeframes.indexOf(timeframe); i >= 0; i--) {
        if (timeframe <= timeframes[i] || timeframe % timeframes[i] !== 0) {
          if (i === 0) {
            sourceTimeframeLitteral = getHms(minimumTimeframe)
          }
          continue
        }

        sourceTimeframeLitteral = getHms(timeframes[i])
        break
      }

      destinationTimeframeLitteral = getHms(timeframe)

      const query = `SELECT min(low) AS low, 
      max(high) AS high, 
      first(open) AS open, 
      last(close) AS close, 
      sum(count) AS count, 
      sum(cbuy) AS cbuy, 
      sum(csell) AS csell, 
      sum(lbuy) AS lbuy, 
      sum(lsell) AS lsell, 
      sum(vol) AS vol, 
      sum(vbuy) AS vbuy, 
      sum(vsell) AS vsell`

      const query_from = `${config.influxDatabase}.${config.influxRetentionPrefix}${sourceTimeframeLitteral}.${config.influxMeasurement}_${sourceTimeframeLitteral}`
      const query_into = `${config.influxDatabase}.${config.influxRetentionPrefix}${destinationTimeframeLitteral}.${config.influxMeasurement}_${destinationTimeframeLitteral}`

      let coverage = `WHERE time >= ${flooredRange.from}ms AND time < ${flooredRange.to}ms`
      coverage += ` AND (${range.markets
        .map(market => `market = '${market}'`)
        .join(' OR ')})`

      const group = `GROUP BY time(${destinationTimeframeLitteral}${
        isOddTimeframe ? ', ' + getHms(flooredRange.from % timeframe) : ''
      }), market fill(none)`

      bars += (flooredRange.to - flooredRange.from) / timeframe

      await this.executeQuery(
        `${query} INTO ${query_into} FROM ${query_from} ${coverage} ${group}`
      )
    }

    now = Date.now()

    const elapsedOp = now - before

    console.log(
      `[storage/influx/resample] done resampling ${parseInt(
        (now - before) / bars
      )}ms per bar (${parseInt(elapsedOp)}ms for ${bars} bars)`
    )

    if (elapsedOp > 10000) {
      console.log(
        `[storage/influx/resample] resample range ${new Date(
          range.from
        ).toISOString()} to ${new Date(range.to).toISOString()} (${
          range.markets.length
        } markets)`
      )
    }
  }

  /**
   * Wrapper for query
   * Query the db
   * Called from resample
   *
   * @param {string} query
   * @param {number?} attempt no of attempt starting at 0 (abort if too much failed attempts)
   * @returns
   */
  async executeQuery(query, attempt = 0) {
    try {
      await this.influx.query(query)

      if (attempt > 0) {
        console.log(
          `[storage/influx] successfully executed query ${attempt} attempt(s)`
        )
      }
    } catch (error) {
      attempt++

      console.error(
        `[storage/influx] query failed (${attempt}${
          attempt === 1
            ? 'st'
            : attempt === 2
            ? 'nd'
            : attempt === 3
            ? 'rd'
            : 'th'
        } attempt)`,
        error.message
      )

      if (attempt >= 5) {
        console.error(
          `too many attemps at executing query\n\n${query}\n\t-> abort`
        )
        throw error.message
      }

      await sleep(500)

      return this.executeQuery(query, attempt)
    }
  }

  /**
   * Called from main
   * API user called method
   *
   * @returns
   */
  fetch({ from, to, timeframe = 60000, markets = [] }) {
    const timeframeLitteral = getHms(timeframe)

    let query = `SELECT * FROM "${config.influxDatabase}"."${config.influxRetentionPrefix}${timeframeLitteral}"."trades_${timeframeLitteral}" WHERE time >= ${from}ms AND time < ${to}ms`

    if (markets.length) {
      query += ` AND (${markets
        .map(marketOrIndex => {
          if (
            config.influxCollectors &&
            marketOrIndex.indexOf(':') === -1 &&
            socketService.serverSocket
          ) {
            const collector = socketService.getNodeByMarket(marketOrIndex)

            if (collector) {
              const markets = collector.markets.filter(market => {
                const [exchange, pair] = market.match(/([^:]*):(.*)/).slice(1, 3)
                const product = parseMarket(exchange, pair)
                if (product.local === marketOrIndex) {
                  return true
                }
              })

              if (markets.length) {
                return markets.map(a => `market = '${a}'`).join(' OR ')
              }
            }
          }

          return `market = '${marketOrIndex}'`
        })
        .join(' OR ')})`
    }

    return this.influx
      .queryRaw(query, {
        precision: 's',
        epoch: 's'
      })
      .then(results => {
        const output = {
          format: this.format,
          columns: {},
          results: []
        }

        if (
          results.results[0].series &&
          results.results[0].series[0].values.length
        ) {
          output.columns = this.formatColumns(
            results.results[0].series[0].columns
          )
          output.results = results.results[0].series[0].values
        }

        if (to > +new Date() - config.influxResampleInterval) {
          return this.appendPendingBarsToResponse(
            output.results,
            markets,
            from,
            to,
            timeframe
          ).then(bars => {
            output.results = bars
            return output
          })
        }

        return output
      })
      .catch(err => {
        console.error(
          `[storage/influx] failed to retrieves trades between ${from} and ${to} with timeframe ${timeframe}\n\t`,
          err.message
        )

        throw err
      })
  }

  /**
   * Concat given results of bars with realtime bars (pending bars)
   * If clustering enabled, use collectors as source of pending bars
   * Otherwise current node pending bars will be used
   * @param {number[][]} bars
   * @param {string[]} markets
   * @param {number} from
   * @param {number} to
   * @returns
   */
  appendPendingBarsToResponse(bars, markets, from, to, timeframe) {
    if (config.influxCollectors && socketService.clusteredCollectors.length) {
      // use collectors nodes pending bars
      return this.requestPendingBars(markets, from, to, timeframe).then(
        pendingBars => {
          return bars.concat(pendingBars)
        }
      )
    } else {
      // use current node pending bars
      const injectedPendingBars = this.getPendingBars(markets, from, to).sort(
        (a, b) => a.time - b.time
      )

      return Promise.resolve(bars.concat(injectedPendingBars))
    }
  }
  async importCollectors() {
    for (const collector of socketService.clusteredCollectors) {
      await new Promise(resolve => {
        let importTimeout = setTimeout(() => {
          console.error(
            '[storage/influx/cluster] collector import was resolved early (5s timeout fired)'
          )
          importTimeout = null
          resolve()
        }, 5000)

        this.promiseOfImport = () => {
          if (importTimeout) {
            clearTimeout(importTimeout)
            resolve()
          }
        }

        collector.write(JSON.stringify({ opId: 'import' }) + '#')
      })
    }

    setTimeout(this.importCollectors.bind(this), config.influxResampleInterval)
  }

  /**
   * Called from the cluster node
   * Return array of realtime bars matching the given criteras (markets, start time & end time)
   * This WILL query all nodes responsible of collecting trades for given markets
   * @param {net.Socket} markets
   * @param {number} from
   * @param {number} to
   */
  async requestPendingBars(markets, from, to, timeframe) {
    const collectors = []

    for (let i = 0; i < markets.length; i++) {
      for (let j = 0; j < socketService.clusteredCollectors.length; j++) {
        if (
          collectors.indexOf(socketService.clusteredCollectors[j]) === -1 &&
          socketService.clusteredCollectors[j].markets.indexOf(markets[i]) !==
            -1
        ) {
          collectors.push(socketService.clusteredCollectors[j])
        }
      }
    }

    const promisesOfBars = []

    for (const collector of collectors) {
      if (
        collector.timeframes &&
        collector.timeframes.indexOf(timeframe) === -1 &&
        collectors.length === 1
      ) {
        throw new Error(`${getHms(timeframe)} timeframe isn't supported`)
      }
      promisesOfBars.push(
        this.requestCollectorPendingBars(collector, markets, from, to)
      )
    }

    return [].concat
      .apply([], await Promise.all(promisesOfBars))
      .sort((a, b) => a.time - b.time)
  }

  /**
   * Called from the cluster node
   * Query specific collector node (socket) for realtime bars matching given criteras
   * @param {net.Socket} collector
   * @param {string[]} markets
   * @param {number} from
   * @param {number} to
   */
  async requestCollectorPendingBars(collector, markets, from, to) {
    return new Promise(resolve => {
      const pendingBarsRequestId = ID()

      let promiseOfPendingBarsTimeout = setTimeout(() => {
        console.error(
          '[storage/influx/cluster] promise of realtime bar timeout fired (pendingBarsRequestId: ' +
            pendingBarsRequestId +
            ')'
        )

        // response empty array as we didn't got the expected bars...
        this.promisesOfPendingBars[pendingBarsRequestId]([])

        // invalidate timeout
        promiseOfPendingBarsTimeout = null
      }, 5000)

      // register promise
      this.promisesOfPendingBars[pendingBarsRequestId] = pendingBars => {
        if (promiseOfPendingBarsTimeout) {
          clearTimeout(promiseOfPendingBarsTimeout)
        }

        // unregister promise
        delete this.promisesOfPendingBars[pendingBarsRequestId]

        resolve(pendingBars)
      }

      collector.write(
        JSON.stringify({
          opId: 'requestPendingBars',
          data: {
            pendingBarsRequestId,
            markets,
            from,
            to
          }
        }) + '#'
      )
    })
  }

  getPendingBars(markets, from, to) {
    const results = []

    for (const market of markets) {
      if (this.pendingBars[market]) {
        for (const timestamp in this.pendingBars[market]) {
          if (this.pendingBars[market][timestamp].close === null) {
            continue
          }

          if (timestamp >= from && timestamp < to) {
            results.push(this.pendingBars[market][timestamp])
          }
        }
      }
    }

    /*console.log(
      `[storage/influx] found ${results.length} pending bars for ${markets.join(',')} between ${new Date(
        +from
      ).toISOString()} and ${new Date(+to).toISOString()}`
    )*/

    return results
  }

  formatColumns(columns) {
    return columns.reduce((acc, name, index) => {
      acc[name] = index
      return acc
    }, {})
  }

  /**
   * Stocke un Order Book (logique AGGR exacte)
   */
  async writeOrderBook(orderBookData) {
    const points = []
    const market = `${orderBookData.exchange}:${orderBookData.pair}`

    // Convertir les bids en points InfluxDB
    orderBookData.bids.forEach((bid) => {
      const priceBasedTimestamp = Math.floor(bid.price * 1000)
      points.push({
        measurement: 'orderbook',
        tags: { market, side: 'bid' },
        fields: { price: bid.price, size: bid.size },
        timestamp: priceBasedTimestamp
      })
    })

    // Convertir les asks en points InfluxDB
    orderBookData.asks.forEach((ask) => {
      const priceBasedTimestamp = Math.floor(ask.price * 1000)
      points.push({
        measurement: 'orderbook', 
        tags: { market, side: 'ask' },
        fields: { price: ask.price, size: ask.size },
        timestamp: priceBasedTimestamp
      })
    })

    if (points.length > 0) {
      await this.influx.writePoints(points, { precision: 'ms' })
    }
  }

  /**
   * Récupère un Order Book depuis InfluxDB
   */
  async getOrderBook(exchange, pair, limit = 50) {
    const market = `${exchange.toUpperCase()}:${pair.toLowerCase()}`
    
    const query = `
      SELECT price, size, side
      FROM orderbook 
      WHERE market = '${market}' AND size > 0
    `
    
    try {
      const results = await this.influx.query(query)
      const bids = results.filter(r => r.side === 'bid')
      const asks = results.filter(r => r.side === 'ask')
      
      if (bids.length > 0 || asks.length > 0) {
        // ✅ TRI EN JAVASCRIPT (pas en SQL)
        const sortedBids = bids
          .map(r => ({price: Number(r.price), size: Number(r.size)}))
          .sort((a, b) => b.price - a.price)  // Décroissant
          .slice(0, limit || bids.length)
        
        const sortedAsks = asks
          .map(r => ({price: Number(r.price), size: Number(r.size)}))
          .sort((a, b) => a.price - b.price)  // Croissant
          .slice(0, limit || asks.length)
        
        return {
          exchange: exchange.toUpperCase(), 
          pair: pair.toLowerCase(), 
          timestamp: Date.now(),
          bids: sortedBids,
          asks: sortedAsks
        }
      } else {
        return null
      }
    } catch (error) {
      console.error(`[InfluxDB] Failed to get order book for ${market}:`, error.message)
      return null
    }
  }

  /**
   * Récupère les paires disponibles pour Order Book
   */
  async getAvailableOrderBookPairs() {
    try {
      const query = `SHOW TAG VALUES FROM orderbook WITH KEY = "market"`
      const results = await this.influx.query(query)
      return results.map(r => r.value)
    } catch (error) {
      console.error(`[InfluxDB] Error getting available pairs:`, error)
      return []
    }
  }

  /**
   * Écrit les données de liquidité dans InfluxDB
   * @param {string} exchange - Nom de l'exchange (ex: 'BINANCE')
   * @param {string} pair - Paire de trading (ex: 'btcusdt')
   * @param {number} timestamp - Timestamp en millisecondes
   * @param {Object} liquidityData - Données calculées par LiquidityCalculator
   */
  async writeLiquidityData(exchange, pair, timestamp, liquidityData) {
    // Générer les pourcentages supportés (0.5% à 30% par 0.5%)
    const supportedPercentages = []
    for (let i = 0.5; i <= 30; i += 0.5) {
      supportedPercentages.push(i)
    }

    // Construire les champs pour InfluxDB
    const fields = {
      // Totaux
      bid_sum_total: liquidityData.bid_sum_total || 0,
      ask_sum_total: liquidityData.ask_sum_total || 0,
      mid_price: liquidityData.mid_price || 0
    }

    // Ajouter tous les pourcentages
    for (const percent of supportedPercentages) {
      // Convertir le pourcentage en nom de champ valide (remplacer . par _)
      const fieldSuffix = percent.toString().replace('.', '_') + 'pct'
      const influxBidKey = `bid_sum_${fieldSuffix}`
      const influxAskKey = `ask_sum_${fieldSuffix}`
      
      // Les données viennent avec le format original (avec point)
      const dataBidKey = `bid_sum_${percent}pct`
      const dataAskKey = `ask_sum_${percent}pct`
      
      fields[influxBidKey] = liquidityData[dataBidKey] || 0
      fields[influxAskKey] = liquidityData[dataAskKey] || 0
    }

    // Point InfluxDB
    const point = {
      measurement: 'liquidity_sums',
      timestamp: timestamp,
      tags: {
        exchange: exchange.toUpperCase(),
        pair: pair.toLowerCase()
      },
      fields: fields
    }

    // Écrire dans InfluxDB avec précision milliseconde
    await this.writePoints([point], { precision: 'ms' })
    
    console.log(`[InfluxDB] Wrote liquidity data for ${exchange}:${pair} with ${supportedPercentages.length * 2 + 3} fields`)
  }

  /**
   * Récupère les données de liquidité depuis InfluxDB
   * @param {string} exchange - Nom de l'exchange
   * @param {string} pair - Paire de trading
   * @param {number|null} timestamp - Timestamp spécifique ou null pour le plus récent
   * @returns {Object|null} Données de liquidité ou null
   */
  async getLiquidityData(exchange, pair, timestamp = null) {
    if (!this.influx) {
      throw new Error('InfluxDB not connected')
    }

    let query
    if (timestamp) {
      query = `
        SELECT * FROM liquidity_sums 
        WHERE exchange = '${exchange.toUpperCase()}' 
        AND pair = '${pair.toLowerCase()}' 
        AND time = ${timestamp}ms
        ORDER BY time DESC 
        LIMIT 1
      `
    } else {
      query = `
        SELECT * FROM liquidity_sums 
        WHERE exchange = '${exchange.toUpperCase()}' 
        AND pair = '${pair.toLowerCase()}' 
        ORDER BY time DESC 
        LIMIT 1
      `
    }

    try {
      const results = await this.influx.query(query)
      
      if (results.length > 0) {
        const data = results[0]
        
        // Générer les pourcentages supportés (0.5% à 30% par 0.5%)
        const supportedPercentages = []
        for (let i = 0.5; i <= 30; i += 0.5) {
          supportedPercentages.push(i)
        }
        
        // Convertir les noms de champs InfluxDB vers les noms API
        const apiData = {
          exchange: exchange.toUpperCase(),
          pair: pair.toLowerCase(),
          timestamp: new Date(data.time).toISOString(),
          source: 'influxdb',
          supported_percentages: supportedPercentages,
          time: new Date(data.time).toISOString(),
          bid_sum_total: data.bid_sum_total || 0,
          ask_sum_total: data.ask_sum_total || 0,
          mid_price: data.mid_price || 0
        }
        
        // Convertir tous les pourcentages (de InfluxDB vers API)
        for (const percent of supportedPercentages) {
          const fieldSuffix = percent.toString().replace('.', '_') + 'pct'
          const influxBidKey = `bid_sum_${fieldSuffix}`
          const influxAskKey = `ask_sum_${fieldSuffix}`
          
          const apiBidKey = `bid_sum_${percent}pct`
          const apiAskKey = `ask_sum_${percent}pct`
          
          apiData[apiBidKey] = data[influxBidKey] || 0
          apiData[apiAskKey] = data[influxAskKey] || 0
        }
        
        return apiData
      }
      
      return null
    } catch (error) {
      console.error(`[InfluxDB] Error querying liquidity data:`, error)
      throw error
    }
  }

  /**
   * Récupère l'historique des données de liquidité
   * @param {string} exchange - Nom de l'exchange
   * @param {string} pair - Paire de trading
   * @param {number} minutes - Nombre de minutes d'historique
   * @param {number|null} percent - Pourcentage spécifique ou null pour total
   * @returns {Object} Données historiques
   */
  async getLiquidityHistory(exchange, pair, minutes, percent = null) {
    // Convertir les noms de champs pour InfluxDB (remplacer . par _)
    let bidField, askField
    if (percent) {
      const fieldSuffix = percent.toString().replace('.', '_') + 'pct'
      bidField = `bid_sum_${fieldSuffix}`
      askField = `ask_sum_${fieldSuffix}`
    } else {
      bidField = 'bid_sum_total'
      askField = 'ask_sum_total'
    }
    
    const query = `
      SELECT time, ${bidField}, ${askField} 
      FROM liquidity_sums 
      WHERE exchange = '${exchange.toUpperCase()}' 
      AND pair = '${pair.toLowerCase()}' 
      AND time >= now() - ${minutes}m 
      ORDER BY time ASC
    `
    
    console.log(`[InfluxDB] Querying ${minutes}min history for ${exchange}:${pair}${percent ? ` (${percent}%)` : ''}`)
    
    try {
      const results = await this.influx.query(query)
      
      const data = results.map(r => ({
        timestamp: r.time,
        bid_sum: r[bidField] || 0,
        ask_sum: r[askField] || 0
      }))
      
      console.log(`[InfluxDB] Found ${data.length} history points for ${exchange}:${pair}`)
      
      return {
        data: data,
        total_points: data.length
      }
    } catch (error) {
      console.error(`[InfluxDB] Error querying history:`, error)
      throw error
    }
  }

  /**
   * Nettoie les anciennes données de liquidité
   * @param {number} threshold - Timestamp seuil (données plus anciennes supprimées)
   * @returns {number} Nombre d'enregistrements supprimés
   */
  async cleanOldLiquidityData(threshold) {
    if (!this.influx) {
      return 0
    }

    try {
      const query = `DELETE FROM liquidity_sums WHERE time < ${threshold}ms`
      
      await this.influx.query(query)
      console.log(`[InfluxDB] Cleaned liquidity data older than ${new Date(threshold).toISOString()}`)
      
      return 1 // InfluxDB ne retourne pas le nombre exact
    } catch (error) {
      console.error(`[InfluxDB] Error cleaning old liquidity data:`, error)
      throw error
    }
  }

  /**
   * Obtient les pourcentages supportés
   * @returns {Array} Liste des pourcentages supportés
   */
  getSupportedPercentages() {
    const percentages = []
    for (let i = 0.5; i <= 30; i += 0.5) {
      percentages.push(i)
    }
    return percentages
  }

  /**
   * Récupère les données de liquidité pour un timestamp spécifique
   * @param {string} exchange - Nom de l'exchange
   * @param {string} pair - Paire de trading
   * @param {number} timestamp - Timestamp en millisecondes
   * @returns {Object|null} Données de liquidité les plus proches du timestamp
   */
  async getLiquidityDataByTimestamp(exchange, pair, timestamp) {
    if (!this.influx) {
      return null
    }

    const query = `
      SELECT * FROM liquidity_sums 
      WHERE exchange = '${exchange.toUpperCase()}' 
      AND pair = '${pair.toLowerCase()}' 
      AND time <= ${timestamp}ms
      ORDER BY time DESC 
      LIMIT 1
    `

    try {
      const results = await this.influx.query(query)
      
      if (results.length > 0) {
        const data = results[0]
        
        // Générer les pourcentages supportés (0.5% à 30% par 0.5%)
        const supportedPercentages = []
        for (let i = 0.5; i <= 30; i += 0.5) {
          supportedPercentages.push(i)
        }
        
        // Convertir les noms de champs InfluxDB vers les noms API
        const liquidityData = {}
        
        // Ajouter les totaux
        liquidityData.bid_sum_total = data.bid_sum_total || 0
        liquidityData.ask_sum_total = data.ask_sum_total || 0
        liquidityData.mid_price = data.mid_price || 0
        
        // Convertir tous les pourcentages (de InfluxDB vers format renderer.bar)
        const marketPrefix = pair.toLowerCase() // btcusdt, ethusdt
        for (const percent of supportedPercentages) {
          const fieldSuffix = percent.toString().replace('.', '_') + 'pct'
          const influxBidKey = `bid_sum_${fieldSuffix}`
          const influxAskKey = `ask_sum_${fieldSuffix}`
          
          // Format pour renderer.bar : btcusdt_bid_sum_30pct
          const rendererBidKey = `${marketPrefix}_bid_sum_${percent}pct`
          const rendererAskKey = `${marketPrefix}_ask_sum_${percent}pct`
          
          liquidityData[rendererBidKey] = data[influxBidKey] || 0
          liquidityData[rendererAskKey] = data[influxAskKey] || 0
        }
        
        return liquidityData
      }
      
      return null
    } catch (error) {
      console.error(`[InfluxDB] Error querying liquidity data by timestamp:`, error)
      return null
    }
  }

  /**
   * Récupère les données de liquidité pour une plage de timestamps
   * @param {string} exchange - Nom de l'exchange
   * @param {string} pair - Paire de trading
   * @param {number} fromTimestamp - Timestamp de début
   * @param {number} toTimestamp - Timestamp de fin
   * @returns {Array} Données de liquidité pour la plage
   */
  async getLiquidityDataByRange(exchange, pair, fromTimestamp, toTimestamp) {
    if (!this.influx) {
      return []
    }

    const query = `
      SELECT * FROM liquidity_sums 
      WHERE exchange = '${exchange.toUpperCase()}' 
      AND pair = '${pair.toLowerCase()}' 
      AND time >= ${fromTimestamp}ms 
      AND time <= ${toTimestamp}ms
      ORDER BY time ASC
    `

    try {
      const results = await this.influx.query(query)
      
      // Générer les pourcentages supportés (0.5% à 30% par 0.5%)
      const supportedPercentages = []
      for (let i = 0.5; i <= 30; i += 0.5) {
        supportedPercentages.push(i)
      }
      
      const processedResults = []
      const marketPrefix = pair.toLowerCase() // btcusdt, ethusdt
      
      for (const data of results) {
        const liquidityData = {
          timestamp: new Date(data.time).getTime(),
          bid_sum_total: data.bid_sum_total || 0,
          ask_sum_total: data.ask_sum_total || 0,
          mid_price: data.mid_price || 0
        }
        
        // Convertir tous les pourcentages
        for (const percent of supportedPercentages) {
          const fieldSuffix = percent.toString().replace('.', '_') + 'pct'
          const influxBidKey = `bid_sum_${fieldSuffix}`
          const influxAskKey = `ask_sum_${fieldSuffix}`
          
          // Format pour renderer.bar : btcusdt_bid_sum_30pct
          const rendererBidKey = `${marketPrefix}_bid_sum_${percent}pct`
          const rendererAskKey = `${marketPrefix}_ask_sum_${percent}pct`
          
          liquidityData[rendererBidKey] = data[influxBidKey] || 0
          liquidityData[rendererAskKey] = data[influxAskKey] || 0
        }
        
        processedResults.push(liquidityData)
      }
      
      return processedResults
    } catch (error) {
      console.error(`[InfluxDB] Error querying liquidity data by range:`, error)
      return []
    }
  }
}

module.exports = InfluxStorage
