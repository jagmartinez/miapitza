export {};

declare global {
    namespace Express {
        interface Request {
            /** Populated by express.json verify when raw body is needed */
            rawBody?: string;
            /** Set only after current DB/session authorization has been reloaded. */
            authContextValidated?: boolean;
        }
    }
}
