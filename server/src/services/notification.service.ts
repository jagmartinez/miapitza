import { ReservationService } from './reservation.service';
import { WebSocketService } from './websocket.service';
import { CompanyService } from './company.service';

export class NotificationService {
    private static interval: NodeJS.Timeout | null = null;
    private static cleanupInterval: NodeJS.Timeout | null = null;
    private static isRunning = false;
    /** Track notified reservation IDs to prevent duplicate notifications */
    private static notifiedReservations = new Set<number>();

    /**
     * Start the notification check interval
     */
    static start(): void {
        if (this.interval) return;

        console.log('Notification Service started');

        // Check every 5 minutes
        this.interval = setInterval(() => {
            this.checkUpcomingReservations();
        }, 5 * 60 * 1000);

        // Initial check
        this.checkUpcomingReservations();

        // Clean up old notification tracking every hour
        this.cleanupInterval = setInterval(() => {
            this.notifiedReservations.clear();
        }, 60 * 60 * 1000);
    }

    /**
     * Stop the notification check interval
     */
    static stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Check for reservations starting in the next 30 minutes and notify via WS
     */
    private static async checkUpcomingReservations(): Promise<void> {
        // Prevent overlapping executions
        if (this.isRunning) return;
        this.isRunning = true;

        try {
            const companies = await CompanyService.getAll();

            for (const company of companies) {
                const now = new Date();
                const in30Minutes = new Date(now.getTime() + 30 * 60 * 1000);

                const upcoming = await ReservationService.getUpcomingReservations(company.id, undefined, 1);

                const soon = upcoming.filter((res) => {
                    const resTime = new Date(res.date);
                    return resTime >= now && resTime <= in30Minutes;
                });

                if (soon.length > 0) {
                    soon.forEach((res) => {
                        // Skip already-notified reservations
                        if (this.notifiedReservations.has(res.id)) return;
                        this.notifiedReservations.add(res.id);

                        // Broadcast ONLY to the correct company's clients
                        WebSocketService.broadcast({
                            type: 'UPCOMING_RESERVATION',
                            payload: {
                                id: res.id,
                                customerName: res.customerName,
                                date: res.date,
                                peopleCount: res.peopleCount,
                                branchId: res.branchId,
                                companyId: company.id
                            }
                        }, { companyId: company.id });
                    });
                }
            }
        } catch (error) {
            console.error('Error checking upcoming reservations:', error);
        } finally {
            this.isRunning = false;
        }
    }
}
