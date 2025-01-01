const axios = require("axios");
const tough = require("tough-cookie");
const { CookieJar } = require("tough-cookie");
const { wrapper: axiosCookieJarSupport } = require("axios-cookiejar-support");

const JSEncrypt = require("node-jsencrypt");
const sjcl = require("sjcl");

const fs = require("fs");

// SJCL warning suppression
sjcl.beware[
  "CBC mode is dangerous because it doesn't protect message integrity."
]();

function encodePostData(username, password, nonce, token, pubkey) {
  var crypto_page = (function () {
    var base64url_escape = function (b64) {
      var out = "";
      for (i = 0; i < b64.length; i++) {
        var c = b64.charAt(i);
        if (c == "+") {
          out += "-";
        } else if (c == "/") {
          out += "_";
        } else if (c == "=") {
          out += ".";
        } else {
          out += c;
        }
      }
      return out;
    };

    var encrypt = function (pubkey, plaintext) {
      var aeskey = sjcl.random.randomWords(4, 0);
      var iv = sjcl.random.randomWords(4, 0);
      var pt = sjcl.codec.utf8String.toBits(plaintext);
      var aes = new sjcl.cipher.aes(aeskey);
      var ct = sjcl.mode.cbc.encrypt(aes, pt, iv);

      var rsa = new JSEncrypt();
      if (rsa.setPublicKey(pubkey) == false) return false;

      var base64 = sjcl.codec.base64;
      var aesinfo = base64.fromBits(aeskey) + " " + base64.fromBits(iv);
      var ck = rsa.encrypt(aesinfo);
      if (ck == false) return false;

      return {
        ct: sjcl.codec.base64url.fromBits(ct),
        ck: base64url_escape(ck),
      };
    };

    var encrypt_post_data = function (pubkey, plaintext) {
      var p = encrypt(pubkey, plaintext);
      return "encrypted=1&ct=" + p.ct + "&ck=" + p.ck;
    };

    return {
      encrypt: encrypt,
      encrypt_post_data: encrypt_post_data,
      base64url_escape: base64url_escape,
    };
  })();

  const base64 = sjcl.codec.base64;
  const dec_key = base64.fromBits(sjcl.random.randomWords(4, 0));
  const dec_iv = base64.fromBits(sjcl.random.randomWords(4, 0));
  const postdata =
    "&username=" +
    username +
    "&password=" +
    encodeURIComponent(password) +
    "&csrf_token=" +
    token +
    "&nonce=" +
    nonce +
    "&enckey=" +
    crypto_page.base64url_escape(dec_key) +
    "&enciv=" +
    crypto_page.base64url_escape(dec_iv);

  return crypto_page.encrypt_post_data(pubkey, postdata);
}

async function extractValuesFromPage(url) {
  try {
    const response = await axios.get(url);
    const pageContent = response.data;

    // Extract pubkey
    const pubkeyMatch = pageContent.match(/var pubkey = '(.*?)';/s);
    const pubkey = pubkeyMatch
      ? pubkeyMatch[1].replace(/\\\n/g, "").replace(/\n/g, "")
      : null;

    // Extract the nonce
    const nonceMatch = pageContent.match(/var\s+nonce\s*=\s*"([^"]*)";/);
    const nonce = nonceMatch ? nonceMatch[1] : null;

    // Extract the token
    const tokenMatch = pageContent.match(/var\s+token\s*=\s*"([^"]*)";/);
    const token = tokenMatch ? tokenMatch[1] : null;

    return { pubkey, nonce, token };
  } catch (error) {
    console.error(`Error fetching or parsing page: ${error.message}`);
    return null;
  }
}

function processStats(logLine) {
  const [timestampISO, totalSentBytes, totalrxBytes] = logLine;
  const totalBytes = totalSentBytes + totalrxBytes;

  const timestamp = new Date(timestampISO).getTime(); // Convert ISO string to UNIX timestamp

  let sentRate = 0;
  let rxRate = 0;
  let totalRate = 0;
  let deltaTime = 0;

  if (!previousLog) {
    previousLog = [timestampISO, totalSentBytes, totalrxBytes];

    // Set cum totals to current values as there is no previous value
    cumSent += totalSentBytes;
    cumrx += totalrxBytes;
    cumTotal = cumSent + cumrx;

    return {
      timestampISO,
      cumTxMB: (cumSent / (1024 * 1024)).toFixed(2), // Convert bytes to MB
      cumRxMB: (cumrx / (1024 * 1024)).toFixed(2),
      cumTotalMB: (cumTotal / (1024 * 1024)).toFixed(2),
      sentRateMbps: ((sentRate * 8) / (1024 * 1024)).toFixed(2), // Convert bytes/sec to Mbps/sec
      rxRateMbps: ((rxRate * 8) / (1024 * 1024)).toFixed(2),
      totalRateMbps: ((totalRate * 8) / (1024 * 1024)).toFixed(2),
      deltaSeconds: deltaTime,
    };
  }

  const [prevTimestampISO, prevSentBytes, prevrxBytes] = previousLog;
  const prevTimestamp = new Date(prevTimestampISO).getTime();
  deltaTime = (timestamp - prevTimestamp) / 1000; // Convert milliseconds to seconds

  if (deltaTime <= 0) return null; // Skip invalid or misordered entries

  let margin = MAX_RATE_BPS * deltaTime;

  let deltaSent, deltarx, deltaTotal;

  //
  // if ((2^32)+current - previous) > margin, then reset,
  // i.e. if (current - previous) > (margin - 2^32), then reset,
  // i.e. if (previous - current) < (2^32 - margin), then reset,
  // Handle Sent Bytes
  const MAX_32BIT = Math.pow(2, 32);

  if (totalrxBytes < prevrxBytes) {
    console.log("Rcvd Stats went down!");
    // Possible overflow or reset
    if (prevrxBytes - totalrxBytes < MAX_32BIT - margin) {
      // Quite possibly a reset detected
      console.log("Reset detected");
      deltarx = totalrxBytes;
    } else {
      // Overflow detected
      console.log("Overflow detected");
      deltarx = totalrxBytes + MAX_32BIT - prevrxBytes;
    }
  } else {
    deltarx = totalrxBytes - prevrxBytes;
  }

  if (totalSentBytes < prevSentBytes) {
    console.log("Sent Stats went down!");
    // Possible overflow or reset
    if (prevSentBytes - totalSentBytes < MAX_32BIT - margin) {
      // Quite possibly a reset detected
      console.log("Reset detected");
      deltaSent = totalSentBytes;
    } else {
      // Overflow detected
      console.log("Overflow detected");
      deltaSent = totalSentBytes + MAX_32BIT - prevSentBytes;
    }
  } else {
    deltaSent = totalSentBytes - prevSentBytes;
  }

  deltaTotal = deltaSent + deltarx;

  // Update cum totals
  cumSent += deltaSent;
  cumrx += deltarx;
  cumTotal += deltaTotal;

  // Calculate rates (bytes per second)
  sentRate = deltaSent / deltaTime;
  rxRate = deltarx / deltaTime;
  totalRate = deltaTotal / deltaTime;

  // Update previous log
  previousLog = [timestampISO, totalSentBytes, totalrxBytes];

  // Return corrected log data
  return {
    timestampISO,
    TxMB: (totalSentBytes / (1024 * 1024)).toFixed(2),
    rxMB: (totalrxBytes / (1024 * 1024)).toFixed(2),
    totalMB: ((totalSentBytes + totalrxBytes) / (1024 * 1024)).toFixed(2),
    deltaTxMB: (deltaSent / (1024 * 1024)).toFixed(2),
    deltaRxMB: (deltarx / (1024 * 1024)).toFixed(2),
    deltaTotalMB: (deltaTotal / (1024 * 1024)).toFixed(2),
    cumTxMB: (cumSent / (1024 * 1024)).toFixed(2),
    cumRxMB: (cumrx / (1024 * 1024)).toFixed(2),
    cumTotalMB: (cumTotal / (1024 * 1024)).toFixed(2),
    sentRateMbps: ((sentRate * 8) / (1024 * 1024)).toFixed(2),
    rxRateMbps: ((rxRate * 8) / (1024 * 1024)).toFixed(2),
    totalRateMbps: ((totalRate * 8) / (1024 * 1024)).toFixed(2),
    deltaSeconds: deltaTime,
  };
}

const baseUrl = "http://192.168.3.1";
const username = "admin";
const password = "admin";

async function login() {
  const result = await extractValuesFromPage(baseUrl);
  if (!result) {
    console.error("Failed to extract required values from the page.");
    return false;
  }

  const encodedPostData = encodePostData(
    username,
    password,
    result.nonce,
    result.token,
    result.pubkey,
  );

  try {
    await axios.post(`${baseUrl}/login.cgi`, encodedPostData, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Origin: baseUrl,
        Connection: "keep-alive",
        Cookie: "lang=eng; admin=deleted",
      },
      jar: cookieJar,
      withCredentials: true,
    });
    console.log("Login successful.");
    return true;
  } catch (error) {
    console.error("Login failed:", error.message);
    return false;
  }
}

function logout() {
  cookieJar.removeAllCookiesSync(); // Clear cookies
}

async function fetchStats() {
  try {
    const response = await axios.get(`${baseUrl}/statistics.cgi`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        Priority: "u=4",
      },
      jar: cookieJar,
      withCredentials: true,
    });

    return response.data;
  } catch (error) {
    console.error("Error fetching statistics:", error.message);
    return null;
  }
}

function objectToTabSeparatedString(data) {
  return fields.map((field) => `${field}: ${data[field]}`).join("\t");
}

function tabSeparatedStringToObject(line) {
  const obj = {};
  line.split("\t").forEach((field) => {
    const [key, value] = field.split(": ").map((str) => str.trim());
    if (fields.includes(key)) {
      // Attempt to parse numbers, otherwise keep as string
      obj[key] = isNaN(value) ? value : parseFloat(value);
    }
  });

  return obj;
}

function logToFile(filename, data) {
  const line = objectToTabSeparatedString(data) + "\n";
  try {
    // Append the formatted line to the file, creating it if necessary
    fs.appendFileSync(filename, line, "utf8");
  } catch (err) {
    console.error(`Error writing to file: ${err.message}`);
  }
}

function loadStatsFromFile(filename) {
  try {
    if (!fs.existsSync(filename)) {
      console.error(`File does not exist: ${filename}`);
      return null;
    }

    // Read the file and get all lines
    const fileContents = fs.readFileSync(filename, "utf8");
    const lines = fileContents.trim().split("\n");

    if (lines.length === 0) {
      console.error(`File is empty: ${filename}`);
      return null;
    }

    // Parse the last line into an object
    const lastLine = lines[lines.length - 1];
    return tabSeparatedStringToObject(lastLine);
  } catch (err) {
    console.error(`Error reading from file: ${err.message}`);
    return null;
  }
}

async function readStats() {
  while (true) {
    let loggedIn = await login();

    while (loggedIn) {
      const timestamp = new Date().toISOString();
      const data = await fetchStats();

      // Detect invalid session by checking for `EthernetBytes` in the response
      if (
        !data ||
        !data.match(/EthernetBytesSent:\d+/) ||
        !data.match(/EthernetBytesReceived:\d+/)
      ) {
        console.warn("Session invalid. Re-logging in...");
        logout();
        loggedIn = false;
        break;
      }

      // Process valid statistics
      const sentMatches = data
        .match(/EthernetBytesSent:(\d+),/g)
        .map((m) => parseInt(m.match(/\d+/)[0]));
      const rxMatches = data
        .match(/EthernetBytesReceived:(\d+),/g)
        .map((m) => parseInt(m.match(/\d+/)[0]));

      const totalSent = sentMatches.reduce((acc, val) => acc + val, 0);
      const totalrx = rxMatches.reduce((acc, val) => acc + val, 0);
      const total = totalSent + totalrx;

      const totalTxMB = Math.round(totalSent / (1024 * 1024));
      const totalRxMB = Math.round(totalrx / (1024 * 1024));
      const totalMB = Math.round(total / (1024 * 1024));

      // Print in the desired format
      //console.log(
      //  `${timestamp}\t${totalTxMB}\t${totalRxMB}\t${totalMB}`,
      //);
      const processedStats = processStats([
        timestamp,
        totalSent,
        totalrx,
      ]);
      const logLine = objectToTabSeparatedString(processedStats);
      logToFile(log_fn, processedStats);
      console.log(logLine);

      await new Promise((resolve) => setTimeout(resolve, 15000)); // Sleep for 15 seconds
    }
    await new Promise((resolve) => setTimeout(resolve, 15000)); // Sleep for 15 seconds
  }
}

let previousLog = null; // To store the previous log line
let cumSent = 0;
let cumrx = 0;
let cumTotal = 0;

// Initialize axios with cookie jar support
axiosCookieJarSupport(axios);
const cookieJar = new CookieJar();

const log_fn = "airtel_stats.log";
const MAX_RATE_BPS = (200 * 1e6) / 8; // 200 Mbps to bytes per second

const fields = [
  "timestampISO",
  "TxMB",
  "rxMB",
  "totalMB",
  "deltaTxMB",
  "deltaRxMB",
  "deltaTotalMB",
  "cumTxMB",
  "cumRxMB",
  "cumTotalMB",
  "sentRateMbps",
  "rxRateMbps",
  "totalRateMbps",
  "deltaSeconds",
];

let statsFromLog = loadStatsFromFile(log_fn);

if (statsFromLog) {
  cumSent = statsFromLog.cumTxMB * 1024 * 1024;
  cumrx = statsFromLog.cumRxMB * 1024 * 1024;
  cumTotal = statsFromLog.cumTotalMB * 1024 * 1024;
}

readStats();
