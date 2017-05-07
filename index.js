const Koa = require('koa')
const Router = require('koa-router')
const parse = require('co-body')
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const readline = require('readline');
const google = require('googleapis');
const googleAuth = require('google-auth-library');

const app = new Router()
const koa = new Koa()

class StatusError extends Error {
	constructor (status, msg) {
		super(msg)
		this.status = status
	}
}

koa.use(async (ctx, next) => {
	try {
		await next()
	} catch (e) {
		ctx.status = e.status || 500
		ctx.body = { error: e.toString() }
	}
})

app.get('/calendar/connect', async (ctx) => {
	var cal = new CalendarUtils('username', g_tokenprovider)
	await cal.init()

	const url = cal.getConnectUrl()
	ctx.status = 302
	ctx.redirect(url)
})

app.get('/calendar/oauth', async (ctx) => {
	var cal = new CalendarUtils('username', g_tokenprovider)
	await cal.init()

	const code = ctx.request.query.code
	await cal.getAccessToken(code)
	ctx.status = 302
	ctx.redirect('/calendar/requests')
})

app.get('/calendar/requests', async (ctx) => {
	var cal = new CalendarUtils('username', g_tokenprovider)
	await cal.init()

	if (await cal.getAccessToken()) {
		const events = await cal.getEvents()
		ctx.body = events.filter((event) => {
			return event.start.dateTime
		}).map((event) => {
			let temp = undefined
			if (event.description && event.description.indexOf('temp:')) {
				var re = /temp\=([0-9]+)/i;
				var found = event.description.match(re)
				if (found.length >= 2) {
					temp = parseInt(found[1])
				}
			}
			return {
				start: event.start.dateTime,
				end: event.end.dateTime,
				name: event.summary,
				desiredTemperature: temp
			}
		})
	} else {
		ctx.status = 401
		ctx.redirect('/calendar/connect')
	}
})

class TokenProvider {
	constructor () {
		this.users = {}
	}

	save() {
		// TODO: STUB
	}

	store(username, access_token) {
		this.users[username] = access_token
	}

	get(username) {
		return this.users[username]
	}
}

const g_tokenprovider = new TokenProvider()

class CalendarUtils {
	constructor (username, tokenprovider) {
		this.user = username
		this.tokenprovider = tokenprovider
	}

	async init() {
		console.log("Initialising CalendarClient...")

		var err, cred_raw = await fs.readFileAsync('client_secret.json', 'utf8')
		if (err) {
			throw new StatusError(500, 'Error getting Google secrets')
		}
		var credentials = JSON.parse(cred_raw)

		var clientSecret = credentials.client_secret;
		var clientId = credentials.client_id;
		var redirectUrl = credentials.redirect_uris[0];
		var auth = new googleAuth();
		this.oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);
	}

	getConnectUrl() {
		console.log("Get connect URL")
		return this.oauth2Client.generateAuthUrl({
			access_type: 'offline',
			scope: ['https://www.googleapis.com/auth/calendar.readonly']
		});
	}

	async getAccessToken(code) {
        const cached = this.tokenprovider.get(this.user)
        if (cached) {
            this.oauth2Client.credentials = cached
            return cached
        } else if (code) {
	        const getTokenRaw = this.oauth2Client.getToken.bind(this.oauth2Client)
	        const getToken = Promise.promisify(getTokenRaw)
	        var err, token = await getToken(code)
            if (err) {
                throw new StatusError(401, 'Unable to get access token')
            }
            this.oauth2Client.credentials = token
            this.tokenprovider.store(this.user, token)
            return token
        } else {
            return null;
        }
    }

	async getEvents() {
		var calendar = google.calendar('v3');

		const getEventsRaw = calendar.events.list.bind(calendar.events)
		const getEvents = Promise.promisify(getEventsRaw)
		var err, response = await getEvents({
			auth: this.oauth2Client,
			calendarId: 'primary',
			timeMin: (new Date()).toISOString(),
			maxResults: 20,
			singleEvents: true,
			orderBy: 'startTime'
		})

		if (err) {
			throw new StatusError(500, 'Unable to get events!')
		}

		return response.items
	}
}

koa.use(app.routes())
koa.use(app.allowedMethods())
koa.listen(process.env.PORT || 4000, () => console.log('Listening on :', process.env.PORT || 4000))
