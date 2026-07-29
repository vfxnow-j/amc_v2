import { prisma } from '@/lib/prisma'

export type MarketPriceResult = {
  price: number
  source: string
  url?: string
  confidence: 'high' | 'medium' | 'low'
}

export type WebSearchResult = {
  title: string
  snippet: string
  link: string
  position: number
}

/**
 * Free web search via local SearXNG instance — no API key needed.
 * SearXNG aggregates results from Google, Bing, and other engines.
 */
async function searchSearXNG(query: string): Promise<WebSearchResult[]> {
  const searxngUrl = process.env.SEARXNG_URL || 'http://host.docker.internal:8888'
  try {
    const url = `${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&engines=google,bing,yahoo,mojeek`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
    })

    if (!response.ok) return []

    const data = await response.json()
    const results: WebSearchResult[] = []

    for (const item of (data.results || []).slice(0, 5)) {
      results.push({
        title: item.title || '',
        snippet: item.content || '',
        link: item.url || '',
        position: results.length + 1,
      })
    }

    return results
  } catch (error) {
    console.error('SearXNG search error:', error)
    return []
  }
}

/**
 * Search for market prices of equipment using configured search provider.
 * Falls back to SearXNG if no API key is configured.
 */
export async function searchMarketPrice(
  assetName: string,
  manufacturer?: string | null,
  model?: string | null
): Promise<MarketPriceResult[]> {
  const apiKeySetting = await prisma.setting.findUnique({
    where: { key: 'market_price_search_api_key' },
  })

  const searchQuery = [assetName, manufacturer, model].filter(Boolean).join(' ') + ' price buy'

  try {
    if (apiKeySetting?.value) {
      const providerSetting = await prisma.setting.findUnique({
        where: { key: 'market_price_search_provider' },
      })
      const provider = (providerSetting?.value as string) || 'serpapi'
      if (provider === 'serpapi') {
        return await searchSerpApi(searchQuery, apiKeySetting.value as string)
      }
    }

    // Free fallback: SearXNG → extract prices from snippets
    const ddgResults = await searchSearXNG(searchQuery)
    const results: MarketPriceResult[] = []
    const pricePattern = /\$\s?([\d,]+(?:\.\d{2})?)/g

    for (const item of ddgResults) {
      const text = `${item.title} ${item.snippet}`
      let priceMatch
      while ((priceMatch = pricePattern.exec(text)) !== null) {
        const price = parseFloat(priceMatch[1].replace(/,/g, ''))
        if (!isNaN(price) && price > 50 && price < 500000) {
          results.push({
            price,
            source: new URL(item.link).hostname.replace('www.', ''),
            url: item.link,
            confidence: 'low',
          })
        }
      }
      pricePattern.lastIndex = 0
    }

    return results
  } catch (error) {
    console.error('Market price search error:', error)
    return []
  }
}

async function searchSerpApi(query: string, apiKey: string): Promise<MarketPriceResult[]> {
  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('q', query)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('engine', 'google_shopping')
  url.searchParams.set('num', '5')

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`SerpAPI error: ${response.status}`)
  }

  const data = await response.json()
  const results: MarketPriceResult[] = []

  if (data.shopping_results) {
    for (const item of data.shopping_results.slice(0, 5)) {
      if (item.price) {
        const price = parseFloat(String(item.price).replace(/[^0-9.]/g, ''))
        if (!isNaN(price) && price > 0) {
          results.push({
            price,
            source: item.source || 'Google Shopping',
            url: item.link,
            confidence: 'medium',
          })
        }
      }
    }
  }

  return results
}

/**
 * Search for market rental rates of equipment using organic Google results.
 * Falls back to SearXNG if no API key is configured.
 */
export async function searchMarketRentalRate(
  assetName: string,
  manufacturer?: string | null,
  model?: string | null
): Promise<MarketPriceResult[]> {
  const apiKeySetting = await prisma.setting.findUnique({
    where: { key: 'market_price_search_api_key' },
  })

  const searchQuery = [assetName, manufacturer, model].filter(Boolean).join(' ') + ' rental rate per day'
  const pricePattern = /\$\s?([\d,]+(?:\.\d{2})?)\s*(?:\/|\s*per\s*)\s*(?:day|daily|d\b)/gi

  try {
    let searchResults: Array<{ title: string; snippet: string; link: string; source?: string }>

    if (apiKeySetting?.value) {
      const url = new URL('https://serpapi.com/search.json')
      url.searchParams.set('q', searchQuery)
      url.searchParams.set('api_key', apiKeySetting.value as string)
      url.searchParams.set('engine', 'google')
      url.searchParams.set('num', '5')

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) throw new Error(`SerpAPI error: ${response.status}`)

      const data = await response.json()
      searchResults = (data.organic_results || []).slice(0, 5)
    } else {
      // Free fallback: SearXNG
      searchResults = await searchSearXNG(searchQuery)
    }

    const results: MarketPriceResult[] = []

    for (const item of searchResults) {
      const text = `${item.title || ''} ${item.snippet || ''}`
      let match
      while ((match = pricePattern.exec(text)) !== null) {
        const price = parseFloat(match[1].replace(/,/g, ''))
        if (!isNaN(price) && price > 0 && price < 100000) {
          results.push({
            price,
            source: item.source || new URL(item.link || 'https://unknown').hostname,
            url: item.link,
            confidence: 'low',
          })
        }
      }
      pricePattern.lastIndex = 0
    }

    return results
  } catch (error) {
    console.error('Market rental rate search error:', error)
    return []
  }
}

/**
 * General web search — uses SerpAPI if configured, otherwise SearXNG (free).
 * Returns top 5 results with title, snippet, link.
 */
export async function webSearch(query: string): Promise<WebSearchResult[]> {
  const apiKeySetting = await prisma.setting.findUnique({
    where: { key: 'market_price_search_api_key' },
  })

  try {
    if (apiKeySetting?.value) {
      const url = new URL('https://serpapi.com/search.json')
      url.searchParams.set('q', query)
      url.searchParams.set('api_key', apiKeySetting.value as string)
      url.searchParams.set('engine', 'google')
      url.searchParams.set('num', '5')

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) throw new Error(`SerpAPI error: ${response.status}`)

      const data = await response.json()
      const results: WebSearchResult[] = []

      if (data.organic_results) {
        for (const item of data.organic_results.slice(0, 5)) {
          results.push({
            title: item.title || '',
            snippet: item.snippet || '',
            link: item.link || '',
            position: item.position || results.length + 1,
          })
        }
      }

      return results
    }

    // Free fallback: SearXNG
    return await searchSearXNG(query)
  } catch (error) {
    console.error('Web search error:', error)
    return []
  }
}
