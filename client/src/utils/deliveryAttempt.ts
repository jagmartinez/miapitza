export interface DeliveryAttemptOptions<T> {
    request: () => Promise<T>;
    onSuccess: (value: T) => void | Promise<void>;
    onError: (message: string, error: unknown) => void;
    onSuccessError?: (error: unknown) => void;
    onPendingChange: (pending: boolean) => void;
    fallbackMessage: string;
}

export function getDeliveryErrorMessage(error: unknown, fallbackMessage: string): string {
    if (typeof error !== 'object' || error === null || !('response' in error)) {
        return fallbackMessage;
    }

    const response = (error as { response?: { data?: { message?: unknown } } }).response;
    const message = response?.data?.message;
    return typeof message === 'string' && message.trim().length > 0
        ? message
        : fallbackMessage;
}

export class DeliveryAttemptGate {
    private active = false;

    isActive(): boolean {
        return this.active;
    }

    async execute<T>(options: DeliveryAttemptOptions<T>): Promise<boolean> {
        if (this.active) {
            return false;
        }

        this.active = true;
        options.onPendingChange(true);
        try {
            let value: T;
            try {
                value = await options.request();
            } catch (error: unknown) {
                options.onError(getDeliveryErrorMessage(error, options.fallbackMessage), error);
                return true;
            }

            try {
                await options.onSuccess(value);
            } catch (error: unknown) {
                if (!options.onSuccessError) {
                    throw error;
                }
                options.onSuccessError(error);
            }
        } finally {
            this.active = false;
            options.onPendingChange(false);
        }

        return true;
    }
}
