import * as Bucket from "@spica-devkit/bucket"
import * as Identity from "@spica-devkit/identity";
import fetch from "node-fetch";
let queryString = require("querystring")
import { v4 as uuidv4 } from 'uuid';

const {
	IDENTITY_FULL_ACCESS_KEY,
	BUCKET_FULL_ACCESS_KEY,
	USERS_BUCKET,
	USER_POLICY,
	YANDEX_CLIENT_SECRET_KEY,
	YANDEX_CLIENT_ID,
	FORGOT_PASSWORD_REQUESTS_BUCKET,
	__INTERNAL__SPICA__PUBLIC_URL__
} = process.env;

const INSTANCE_PUBLIC_URL = __INTERNAL__SPICA__PUBLIC_URL__;


const MESSAGES = {
	IDENTITY_ALREADY_EXIST: "Identity already exist",
	REGISTIRATION_SUCCESSFULL: "Successfully registerd",
	INVALID_EMAIL: "Please enter valid email",
	LOGIN_SUCCESSFULL: "Successfully logged",
	SHORT_PASSWORD: "The password must be min 6 char",
	IDENTITY_NOT_EXIST: "Identity not exist",
	FORGOT_PASSWORD_MAIL_SENT: "Forgot password mail sent",
	UUID_NOT_EXIST: "Uuid not exist",
	PASSWORD_CHANGED_SUCCESSFULL: "Your password has been changed successfully",

	EXPIRED: 'Request has been expired'
};


Identity.initialize({ apikey: IDENTITY_FULL_ACCESS_KEY });
Bucket.initialize({ apikey: BUCKET_FULL_ACCESS_KEY });


function isValidEmail(email) {
	const emailRegex = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/g;
	return emailRegex.test(email);
}


function errorResponse(res, errorMessage) {
	return res.status(400).send({
		message: errorMessage
	})
}


async function createUser(name, surname, email, identifier, password) {
	const user = await Bucket.data.insert(USERS_BUCKET, {
		name,
		surname,
		email
	}).catch(err => {
		res = errorResponse(res, err.message);
	});

	if (!user) return res;

	const identityObject = {
		identifier,
		password,
		policies: [USER_POLICY],
		attributes: {
			user: user._id
		}
	}

	return Identity.insert(identityObject);
}


function getIdentityByIdentifier(identifier) {
	return Identity.getAll({
		filter: {
			identifier
		}
	}).then(res => res[0])
}


export async function register(req, res) {

	const {
		name,
		surname,
		email,
		password
	} = req.body;

	const isEmail = isValidEmail(email);
	const isPasswordShort = !password || password.length < 6;

	if (!isEmail) {
		return errorResponse(res, MESSAGES.INVALID_EMAIL)
	};

	if (isPasswordShort) {
		return errorResponse(res, MESSAGES.SHORT_PASSWORD)
	}

	const existIdentity = await getIdentityByIdentifier(email)

	if (existIdentity) {
		return errorResponse(res, MESSAGES.IDENTITY_ALREADY_EXIST)
	};

	await createUser(name, surname, email, email, password);

	return res.status(200).send({
		message: MESSAGES.REGISTIRATION_SUCCESSFULL
	});

};


export async function login(req, res) {

	const {
		email,
		password
	} = req.body;

	try {

		const jwt = await Identity.login(email, password);
		return res.status(200).send({
			message: MESSAGES.LOGIN_SUCCESSFULL,
			token: jwt
		});

	} catch (error) {

		return res.status(error.statusCode).send({
			message: error.message
		});

	}
}


export async function onIdentityInsert(insert) {

	const identity = insert.document;
	const {
		given_name,
		family_name,
		email,
		user
	} = identity.attributes;

	if (user) return;

	const userObject = {
		name: given_name,
		surname: family_name,
		email
	}

	const createdUser = await Bucket.data.insert(USERS_BUCKET, userObject);

	identity.attributes["user"] = createdUser._id;
	identity.policies = [USER_POLICY];
	const identityId = identity._id;
	delete identity._id;
	delete identity.password;

	await Identity.update(identityId, identity);
	return;
}


function getRedirectUri() {
	return INSTANCE_PUBLIC_URL + "/fn-execute/fetch-yandex-token"
}

export function authorizeYandex(req, res) {
	const redirectUri = getRedirectUri();
	const state = uuidv4();

	return res.status(200).send(`https://oauth.yandex.com/authorize?client_id=${YANDEX_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&state=${state}`);
}

export async function fetchYandexToken(req, res) {

	const body = queryString.stringify({
		grant_type: 'authorization_code',
		client_id: YANDEX_CLIENT_ID,
		client_secret: YANDEX_CLIENT_SECRET_KEY,
		code: req.query.code
	});

	const rawResponse = await fetch('https://oauth.yandex.com/token', {
		method: 'POST',
		body
	});

	const response = await rawResponse.json();

	const token = await completeYandexAuthorization(response.access_token);
	return res.status(200).send({ token, ...response })
}

async function completeYandexAuthorization(accessToken) {

	const rawResponse = await fetch(`https://login.yandex.ru/info`, {
		method: 'GET',
		headers: {
			'Authorization': `OAuth ${accessToken}`,
		},
	});


	const {
		id,
		psuid,
		first_name,
		last_name,
		default_email
	} = await rawResponse.json();

	const jwtToken = () => Identity.login(id, psuid);

	const existIdentity = await getIdentityByIdentifier(id);

	if (existIdentity) {
		return jwtToken();
	};

	await createUser(first_name, last_name, default_email, id, psuid);

	return jwtToken();
}


export async function sendPasswordResetMail(req, res) {

	const { email } = req.body;
	const isEmail = isValidEmail(email);

	if (!isEmail) {
		return errorResponse(res, MESSAGES.INVALID_EMAIL)
	};

	const existIdentity = await getIdentityByIdentifier(email);

	if (!existIdentity) {
		return errorResponse(res, MESSAGES.IDENTITY_NOT_EXIST)
	};

	const uuid = uuidv4();
	// 10 Minutes later
	const expire_at = new Date(new Date().getTime() + 600000);
	const document = {
		email,
		uuid,
		expire_at
	}

	try {
		await Bucket.data.insert(FORGOT_PASSWORD_REQUESTS_BUCKET, document);

		return res.status(200).send({
			message: MESSAGES.FORGOT_PASSWORD_MAIL_SENT
		})
	} catch (error) {
		return errorResponse(res, error.message);
	}
}

export async function updateUserPassword(req, res) {

	const { password, uuid } = req.body;

	const [forgotPasswordReq] = await Bucket.data.getAll(FORGOT_PASSWORD_REQUESTS_BUCKET, {
		queryParams: {
			filter: { uuid }
		}
	});

	if (!forgotPasswordReq) {
		return errorResponse(res, MESSAGES.UUID_NOT_EXIST);
	}

	const isExpired = new Date() > new Date(forgotPasswordReq.expire_at);

	if (isExpired) {
		return res.status(400).send({ message: MESSAGES.EXPIRED });
	}

	const [{ _id, ...identityWithoutId }] = await Identity.getAll({
		filter: {
			identifier: forgotPasswordReq.email
		}
	});

	const updatedIdentity = {
		...identityWithoutId,
		password
	};

	try {
		await Identity.update(_id, updatedIdentity)

		let patchedFields = {
			expire_at: new Date(),
			updated_at: new Date()
		}

		await Bucket.data.patch(FORGOT_PASSWORD_REQUESTS_BUCKET, forgotPasswordReq._id, patchedFields);

		return res.status(200).send({ message: MESSAGES.PASSWORD_CHANGED_SUCCESSFULL });
	}
	catch (error) {
		console.error("user password could not be updated", error);
		return errorResponse(res, error.message)
	};

};