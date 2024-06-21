const nodemailer = require("nodemailer");

const {
	SMTP_HOST,
	SMTP_PORT,
} = process.env;

export function onPasswordResetRequestInsert(document) {
	const data = document.current;
	
	const baseUrl = "http://localhost:3000";
	const path = "password-reset"
	const resetLink = generateForgotPasswordUrl(baseUrl,path,data.uuid);

	const emailTempalte = `
	<!DOCTYPE html>
	<html>
	<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333333;">
		<div style="background-color: #f4f4f4; padding: 20px; text-align: center; border-bottom: 1px solid #cccccc;">
			<h1 style="margin: 0;">Vals Diamond</h1>
		</div>
		<div style="padding: 20px;">
			<p>Hello,</p>
			<p>Let's reset your password.</p>
			<a href=${resetLink} style="background-color: #4CAF50; color: white; padding: 10px 20px; text-align: center; text-decoration: none; display: inline-block; font-size: 16px; margin: 20px 0; cursor: pointer; border-radius: 5px;">Reset Password</a>
		</div>
		<div style="background-color: #f4f4f4; padding: 10px; text-align: center; border-top: 1px solid #cccccc; font-size: 12px; color: #888888;">
			<p>If you did not request a password reset, please ignore this email.</p>
		</div>
	</body>
	</html>
	`;

	sendMail(data.email,"Vals Diamond - Your password reset request.",emailTempalte)
};

export async function sendMail(email, subject, html) {

	const transporter = nodemailer.createTransport({
		host: SMTP_HOST,
		port: SMTP_PORT,
		secure: true,
		auth: {
			user: "emreecndnn@gmail.com",
			pass: "zpedywwqovyfjots"
		}
	});

	const data = {
		from: "emreecndnn@gmail.com",
		to: email,
		subject,
		html
	};

	await transporter.sendMail(data, (err, data) => {
		if (err) console.log("Error", err);
		else console.log("email sent!");

	});

	return console.log("email-sent");
};

function generateForgotPasswordUrl(baseUrl,path,uuid){
	return `${baseUrl}/${path}?uuid=${uuid}`
};