'use strict'
const http = require('http')
const PORT = 8686

const path = require('path')
const fs = require('fs')
const mustache = require('mustache')
const yaml = require('js-yaml')
const moment = require('moment')
const cliProgress = require('cli-progress')

const args = require('yargs').argv
const baseUrl = args._[0]
let folderName = args._[1]
const maxPages = args['max-pages'] ?? 5000
const brokenStatusCode = args['status-code'] ?? 404

if (undefined === baseUrl) {
  console.log('The argument website to test is mandatory')
  process.exit(-1)
}
if (undefined === folderName) {
  folderName = baseUrl.replaceAll('/', '_').replaceAll(':', '')
}

const url = new URL(baseUrl)
const hostname = url.hostname.replace(/[^a-zA-Z0-9]/g, '_')
const directoryPath = path.join(__dirname, '..', 'storage', 'datasets', folderName);

(async () => {
  const errorsByPage = []
  if (fs.existsSync(directoryPath)) {
    const files = fs.readdirSync(directoryPath)
    const errorTypes = {}

    if (files.length > 0) {
      let totalIssuesCount = 0
      let pagesWithIssues = 0
      let startTime
      let endTime
      const brokenLinks = []

      const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic)
      progressBar.start(files.length, 0)
      files.forEach((file, index) => {
        if (maxPages !== 'all' && index > maxPages) {
          return
        }
        const rawData = fs.readFileSync(path.join(directoryPath, file))
        const document = JSON.parse(rawData)

        if (document.status_code === 200 && undefined !== document.pa11y && document.pa11y.length > 0) {
          totalIssuesCount += document.pa11y.length
          pagesWithIssues++

          document.pa11y.forEach(issue => {
            const code = issue.code
            errorTypes[code] ? errorTypes[code]++ : errorTypes[code] = 1
          })

          errorsByPage.push({
            url: document.url,
            index,
            length: document.pa11y.length,
            pa11y: document.pa11y.map(p => {
              return {
                message: p.message,
                mobile: p.mobile,
                context: p.context,
                label: parseErrorCode(p.code).label
              }
            })
          })
        }
        for (const linkId in document.links ?? []) {
          const link = document.links[linkId]
          if (link.status_code < brokenStatusCode) {
            continue
          }
          brokenLinks[link.url] = {
            url: link.url,
            status_code: link.status_code,
            message: link.message,
            color: link.status_code < 300 ? 'success' : link.status_code < 400 ? 'info' : link.status_code < 500 ? 'warning' : 'danger',
            referrers: (brokenLinks[link.url] ?? { referrers: [] }).referrers.concat([{
              url: document.url,
              text: link.text,
              type: link.type
            }])
          }
        }

        if (index === 0) {
          startTime = document.timestamp
        }
        if (index === files.length - 1) {
          endTime = document.timestamp
        }

        progressBar.update(index + 1)
      })
      progressBar.stop()

      const duration = getDuration(startTime, endTime)

      let warning = ''
      if (files.length > maxPages) {
        warning += `<div class="alert alert-warning" role="alert">This summary report is limited to the first ${maxPages} pages!</div>`
      }
      const stats = getStats(totalIssuesCount, pagesWithIssues, files.length, duration, endTime, brokenLinks.length)

      createSummaryReportHTML(baseUrl, warning, stats, errorTypes, errorsByPage, brokenLinks, brokenStatusCode)
    } else {
      console.error(`File not found in ${directoryPath}`)
    }
  } else {
    console.error(`${folderName} folder not found`)
  }
})()
// Utility functions
function htmlEntities (str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
function loadTranslations (language) {
  try {
    const translationFile = `./src/Render/translations/messages.${language}.yaml`
    return yaml.load(fs.readFileSync(translationFile, 'utf8'))
  } catch (error) {
    console.error(`Error loading translations for language ${language}:`, error.message)
    return {}
  }
}
function getTranslation (language, key) {
  const translations = loadTranslations(language)
  const keys = key.split('.')
  const translation = keys.reduce((obj, k) => obj[k], translations)
  return translation || ''
}
function getDate (timestamp) {
  const dateObj = moment(timestamp)
  // const dateFormat = dateObj.format("DD/MM/YYYY HH:mm");
  return dateObj.format('DD/MM/YYYY')
}
function getDuration (startTime, endTime) {
  const start = moment(startTime)
  const end = moment(endTime)

  const differenceInMilliseconds = end.diff(start)

  const duration = moment.duration(differenceInMilliseconds)

  // Formatting the duration
  const hours = Math.floor(duration.asHours())
  const minutes = Math.floor(duration.minutes())
  const seconds = Math.floor(duration.seconds())

  switch (true) {
    case hours > 0:
      return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
    case minutes > 0:
      return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
    default:
      return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
  }
}

// Audit-specific functions
function getStats (totalIssuesCount, pagesWithIssues, totalPages, duration, endTime, brokenLinksCount) {
  let statsErrors = ''
  if (totalIssuesCount > 0) {
    statsErrors += `<span><strong>${totalIssuesCount}</strong> error${totalIssuesCount !== 1 ? 's' : ''} found on <strong>${pagesWithIssues}</strong> page${pagesWithIssues !== 1 ? 's' : ''}</span>`
  } else {
    statsErrors += '<span class="d-flex align-items-center"><span class="fs-2 me-2 lh-1">🥳</span> Yippee ki‐yay! No accessibility error found.</span>'
  }
  if (brokenLinksCount > 0) {
    statsErrors += `<span class="text-muted ms-3">💀 <strong>${brokenLinksCount}</strong> broken link${brokenLinksCount !== 1 ? 's' : ''}</span>`
  }

  const auditStats = `<span class="text-muted mx-3" title="Audit duration"><i class="bi bi-stopwatch" aria-hidden="true"></i> <strong>${duration}</strong></span>
        <strong>${totalPages}</strong> audited pages on <strong>${getDate(endTime)}</strong>`

  return `${statsErrors} <p class="ms-md-auto mb-0">${auditStats}</p>`
}
function parseErrorCode (errorCode) {
  const errorCodeSplit = errorCode.split('.')
  const techniqueCode = errorCodeSplit[4]
  const techniqueCodeDetail = errorCodeSplit[5]
  let techniqueLabel
  let techniqueLabelDetail

  const getTechniqueText = (code) => {
    return getTranslation('en', 'accessibility.techniques.' + code)
  }

  const makeTechniqueLink = (code) => {
    return `<a class="text-decoration-none" href="https://www.w3.org/TR/WCAG20-TECHS/${code}" target="_blank">${code}</a>`
  }

  if (techniqueCode.includes(',')) {
    const multipleErrors = techniqueCode.split(',')
    techniqueLabel = '<ul class="list-unstyled">'
    multipleErrors.forEach((code) => {
      if (!/^a/i.test(code)) {
        techniqueLabel += `<li>${makeTechniqueLink(code)} <i class="bi bi-arrow-bar-right mx-2" aria-hidden="true"></i> ${getTechniqueText(code)}</li>`
      }
    })
    techniqueLabelDetail = htmlEntities(getTranslation('en', 'accessibility.techniques_help.' + techniqueCodeDetail))
    if (techniqueLabelDetail) {
      techniqueLabel += `<li class="text-muted"><i class="bi bi-backspace-reverse" aria-hidden="true"></i> ${techniqueLabelDetail}</li>`
    }
    techniqueLabel += '</ul>'
  } else {
    techniqueLabel = `${makeTechniqueLink(techniqueCode)} <i class="bi bi-arrow-bar-right mx-2" aria-hidden="true"></i> ${getTechniqueText(techniqueCode)}`
    techniqueLabelDetail = htmlEntities(getTranslation('en', 'accessibility.techniques_help.' + techniqueCodeDetail))
    if (techniqueLabelDetail) {
      techniqueLabel += `<span class="ms-3 text-muted"><i class="bi bi-backspace-reverse" aria-hidden="true"></i> ${techniqueLabelDetail}</span>`
    }
  }

  return {
    code: techniqueCode,
    label: techniqueLabel
  }
}
function createSummaryReportHTML (baseUrl, warning, stats, errorTypes, errorsByPage, brokenLinks, brokenStatusCode) {
  const summaryTemplate = './src/Render/templates/summary.html'
  const summaryTemplateContent = fs.readFileSync(summaryTemplate, 'utf8')

  if (!fs.existsSync('./storage/reports/')) {
    fs.mkdirSync('./storage/reports/', { recursive: true })
  }

  const summaryData = {
    url: baseUrl,
    hasError: Object.keys(errorTypes).length > 0,
    hasBrokenLinks: Object.keys(brokenLinks).length > 0,
    color: Object.keys(errorTypes).length ? 'danger' : 'success',
    stats,
    errorTypes: Object.keys(errorTypes).map((index) => {
      return {
        label: parseErrorCode(index).label,
        counter: errorTypes[index]
      }
    }),
    errorsByPage,
    statusCode: brokenStatusCode,
    brokenLinks: Object.values(brokenLinks).map((element, index) => {
      return { ...element, index, length: element.referrers.length }
    }),
    warning
  }

  const renderedTemplate = mustache.render(summaryTemplateContent, summaryData)

  const reportPath = `./storage/reports/${hostname}-a11y.html`

  fs.writeFileSync(reportPath, renderedTemplate, 'utf8')
  console.log(`The summary report has been successfully generated: ${reportPath}`)

  readReport(reportPath)
}
function readReport (reportPath) {
  fs.readFile(reportPath, function (err, html) {
    if (err) throw err

    http.createServer(function (request, response) {
      response.writeHeader(200, { 'Content-Type': 'text/html' })
      response.write(html)
      response.end()
    }).listen(PORT)

    console.log(`View the report locally: http://localhost:${PORT}`)
  })
}
