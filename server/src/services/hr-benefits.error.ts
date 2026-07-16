export class HrBenefitsError extends Error {
  constructor(message: string, public readonly statusCode = 400, public readonly code = 'HR_BENEFITS_INVALID') {
    super(message);
  }
}
