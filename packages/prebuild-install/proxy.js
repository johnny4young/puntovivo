const tunnel = require('tunnel-agent')
const util = require('./util')

function applyProxy (reqOpts, opts) {
  const log = opts.log || util.noopLogger

  const proxy = opts['https-proxy'] || opts.proxy

  if (proxy) {
    const parsedDownloadUrl = new URL(reqOpts.url)
    const parsedProxy = new URL(proxy)
    const proxyHost = parsedProxy.hostname.replace(/^\[(.*)\]$/, '$1')
    const credentialsStart = proxy.indexOf('//') + 2
    const authorityEnd = [ '/', '?', '#' ]
      .map(separator => proxy.indexOf(separator, credentialsStart))
      .filter(index => index !== -1)
      .reduce((first, index) => Math.min(first, index), proxy.length)
    const rawAuthority = proxy.slice(credentialsStart, authorityEnd)
    const credentialsEnd = rawAuthority.lastIndexOf('@')
    const rawCredentials = credentialsEnd !== -1
      ? rawAuthority.slice(0, credentialsEnd)
      : null
    const proxyAuth = rawCredentials === null
      ? null
      : decodeURIComponent(parsedProxy.username) +
        (rawCredentials.includes(':')
          ? `:${decodeURIComponent(parsedProxy.password)}`
          : '')
    const uriProtocol = (parsedDownloadUrl.protocol === 'https:' ? 'https' : 'http')
    const proxyProtocol = (parsedProxy.protocol === 'https:' ? 'Https' : 'Http')
    const tunnelFnName = [uriProtocol, proxyProtocol].join('Over')
    reqOpts.agent = tunnel[tunnelFnName]({
      proxy: {
        host: proxyHost,
        port: +parsedProxy.port,
        proxyAuth
      }
    })
    log.http('request', 'Proxy setup detected (Host: ' +
    proxyHost + ', Port: ' +
      parsedProxy.port + ', Authentication: ' +
      (proxyAuth ? 'Yes' : 'No') + ')' +
      ' Tunneling with ' + tunnelFnName)
  }

  return reqOpts
}

module.exports = applyProxy
