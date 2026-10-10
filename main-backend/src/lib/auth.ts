import { betterAuth } from "better-auth";
import { Client, Pool } from "pg";
import { type Env } from "../types";

const commonConfig = {
    emailAndPassword: {
        enabled: true,
    },
    appName: "Remain",
};
let authInstance: ReturnType<typeof initializeAuth> | undefined;

function initializeAuth(env: Env["Bindings"]) {
    return betterAuth({
        ...commonConfig,
        database: new Client({
            connectionString: env.PG.connectionString,
        }),
    });
}

export function getAuth(env: Env["Bindings"]) {
    if (!authInstance) {
        authInstance = initializeAuth(env);
    }

    return authInstance;
}

const isCloudflare = typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers";

export const auth = !isCloudflare
    ? betterAuth({
        ...commonConfig,
        database: new Pool({
            connectionString:
                process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG,
        }),
    })
    : undefined;

// export const auth = typeof process !== "undefined"
//     ? betterAuth({
//         ...commonConfig,
//         database: new Pool({
//             connectionString:
//                 process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG,
//         }),
//     })
//     : undefined;
