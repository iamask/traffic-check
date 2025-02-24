import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

export default {
    async scheduled(event, env) {
        console.log(JSON.stringify(env));

        const API_TOKEN = env.API_TOKEN;
        const ZONE_TAG = env.ZONE_TAG;
        const SENDER_EMAIL = "admin@zxc.co.in"; // Sender email
        const RECIPIENT_EMAIL = "ajays@cloudflare.com"; // Recipient email

        console.log("ZONE_TAG:", ZONE_TAG);

        if (!ZONE_TAG) {
            console.error("Error: ZONE_TAG is not set", { status: 400 });
            return;
        }

        // Time calculation for 15-minute range
        const now = new Date();
        const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
        const formattedStartTime = fifteenMinutesAgo.toISOString();
        const formattedEndTime = now.toISOString();

        // GraphQL Query
        const queryTraffic = `
            query Viewer {
                viewer {
                    zones(filter: { zoneTag: "${ZONE_TAG}" }) {
                        httpRequestsAdaptiveGroups(
                            filter: {
                                datetime_geq: "${formattedStartTime}"
                                datetime_lt: "${formattedEndTime}"
                                clientRequestHTTPHost: "f1.zxc.co.in"
                            }
                            limit: 10000
                        ) {
                            count
                        }
                    }
                }
            }
        `;

        // Fetch data from Cloudflare GraphQL API
        const fetchQuery = async (payload) => {
            try {
                const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${API_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();
                
                console.log("GraphQL Response:", JSON.stringify(result, null, 2)); // Debugging

                if (result.errors) {
                    console.error("GraphQL API error:", JSON.stringify(result.errors, null, 2));
                    throw new Error("GraphQL API returned errors.");
                }

                if (!result.data || !result.data.viewer || !result.data.viewer.zones) {
                    console.error("Unexpected API response:", JSON.stringify(result, null, 2));
                    throw new Error("Invalid data format from Cloudflare GraphQL API.");
                }

                return result.data;
            } catch (error) {
                console.error("Error fetching data from Cloudflare GraphQL API:", error);
                throw error;
            }
        };

        try {
            const trafficData = await fetchQuery({
                query: queryTraffic
            });

            const requestGroups = trafficData.viewer.zones[0]?.httpRequestsAdaptiveGroups || [];
            const requestCount = requestGroups.length > 0 ? requestGroups[0]?.count || 0 : 0;

            if (requestCount === 0) {
                console.log("No traffic detected in the last 15 minutes. Sending alert email...");

                const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>No Traffic Alert</title>
                    <style>
                        body { font-family: Arial, sans-serif; background-color: #f9f9f9; color: #333; text-align: center; padding: 20px; }
                        .alert { background-color: #ff4c4c; color: white; padding: 15px; border-radius: 5px; display: inline-block; }
                    </style>
                </head>
                <body>
                    <h1 class="alert">🚨 No Traffic Alert 🚨</h1>
                    <p>No traffic has been detected in the last 15 minutes for your Cloudflare zone.</p>
                    <p>Time Range: ${formattedStartTime} - ${formattedEndTime}</p>
                    <p>Please investigate to ensure normal operation.</p>
                </body>
                </html>`;

                const msg = createMimeMessage();
                msg.setSender({ name: "Cloudflare Alert", addr: SENDER_EMAIL });
                msg.setRecipient(RECIPIENT_EMAIL);
                msg.setSubject("🚨 No Traffic Alert - Cloudflare Zone");
                msg.addMessage({ contentType: 'text/html', data: htmlContent });

                const message = new EmailMessage(SENDER_EMAIL, RECIPIENT_EMAIL, msg.asRaw());
                
                try {
                    await env.SEND_EMAIL.send(message);
                    console.log("Alert email sent successfully!");
                } catch (e) {
                    console.error(`Error sending email: ${e.message}`);
                }
            } else {
                console.log(`Traffic detected: ${requestCount} requests in the last 15 minutes.`);
            }
        } catch (error) {
            console.error("Error processing the scheduled event:", error);
        }
    }
};
