import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Restaurant System API',
            version: '1.0.0',
            description: 'API documentation for the Multi-tenant Restaurant Management System',
        },
        servers: [
            {
                url: process.env.API_PUBLIC_URL || 'http://localhost:3000',
                description: process.env.API_PUBLIC_URL ? 'Configured server' : 'Local development server',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
        security: [
            {
                bearerAuth: [],
            },
        ],
    },
    apis: ['./src/routes/*.ts', './src/controllers/*.ts'], // Path to the API docs
};

export const swaggerSpec = swaggerJsdoc(options);
