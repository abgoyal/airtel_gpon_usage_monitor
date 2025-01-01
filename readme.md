# Simple airtel G-2425G-A network stats monitoring script.

# Explanation

Airtel is a FTTH isp in India. They offer a so-called "unlimited" home plan that
has a "FUP" (Fair Use Policy) restriction of 3300GB per month of usage. Not too shabby.

The problem is, they don't provide any way of tracking this usage. The connection
gets capped to 2mbps! (two mega BITS per second - as if we were in in 2003!), and thats
when you find out that you have exceeded the usage limit. This bandwidth cap will then
only get removed at the start of the next billing cycle. They don't offer a data addon,
upgrade, etc that will allow a bit more usage to tide one over till the next cycle!

(I do want to note that they are otherwise a terrific ISP and I have been a happy user
with them for 20+ years, transitioning from dialup(56kbps), to adsl (4Mbps), to vdsl (40Mbps)
, and finally to gigabit ftth).

Anyway, I wanted to track what my usage looks like, so that I don't hit the cap and have to
live like caveperson for the remainder of the cycle.

Normally this would be easy: just check the ftth router!

But nyet! The Nokia G-2425G-A device has a 32bit counter for data transfer! No, really!
In 2024!

At gigabit speeds, this counter can overflow within ~30seconds!

So thats one problem.

Next: I use a "smart" plug to power-off this device during the night for half hour or so.
This is a holdover from the vdsl days when the vdsl router would sometimes get stuck at low
speeds (possibly the noise profile changed and the modem didn't retrain? just guessing). So
The nightly reboot is the solution I found, and it worked for years. When the GPON model came
in, I plugged it into the same plug - why not?

So this is the second problem: the router stats get reset at every restart. Now to be clear
the modem can restart otherwise too - sometimes I change a config and need to restart, for example.


Third problem: the modem has only a webui. It supposedly has a telned interface too, but that 
supposedly required "jailbreaking" the modem. The FTTH connection being a critical life need,
I am  not interested in shennanigans like these. So we need to scrape the webui it provides the stats on.

The webui has this silly, utterly miguided attempt at encrypting the username password while logging into the
device. All it achieves by doing this is that you cant just use curl to scrape it. You have to run javascript and
replicate the encryption it uses.


# Approach

I originally used puppeteer to build a PoC. It worked, but I need this script to run 24x7 and scrape the stats
every 15 seconds or so. Why so frequently? so that I can reliably detect when the overflow happens in the stats.
Anything less frequent will miss an overflow when datatransfer is on at full tilt.

I also needed this to run on a raspberry pi I already had deployed as a home server on the same network, connected
to the Nokia router via ethernet. While puppeteer would work, its hardly light weight. And all of that for just some
stats?

So I took at look at the login encryption code served in the html, and replicated it using nodejs. Fortunately,
there was no obfuscation or minification in the served javascript. Even more fortunately, most of the
encryption etc was being done using a module that was on npm. Even better, though the module used (jsencrypt)
was browser-only (and needed globals found in browser context only), the author had also made available its nodejs
equivalent as (node-jsencrypt). There was a small amount of code that called jsencrypt that I simply pasted from
the served html. 

So in the end I was able to make the login work purely in nodejs, with no browser-automation etc.

# Running


Install node modules:

``` bash
npm install
```


just run:

``` bash
nodejs index.js
````

The script outputs a (very!) wide log containing all the stats. It tries to correct for overflows and reboots.
It mostly succeeds, but can sometimes get confused. Good news it, it will mostly over-estimate the data transfer,
so for the original purpose it still works well.


# License

All my code is MIT. Everything else is as per the original license.

# Disclaimer

Use at your own risk! 

