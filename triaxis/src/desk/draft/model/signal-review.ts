export interface SignalCheck {
  label: string;
  status: 'pass' | 'warning' | 'fail' | 'pending';
  detail: string;
}

export interface SignalReview {
  checks: SignalCheck[];
  missing: string[];
  verdict: 'Rejected' | 'Incomplete' | 'Price checks complete';
}
