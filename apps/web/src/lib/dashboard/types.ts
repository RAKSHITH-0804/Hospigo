export type DashboardSummary = {
  branchId: string;
  sections: {
    money: boolean;
    queue: boolean;
    vitals: boolean;
    doctor: boolean;
    approvals: boolean;
  };
  today: {
    registrations: number;
    visits: number;
    waiting: number;
    completed: number;
    longWaiting: number | null;
    collectionPaise: number | null;
  };
  trend: Array<{ date: string; visits: number; collectionPaise: number | null }>;
  paymentMix: Array<{ mode: string; code: string; amountPaise: number }>;
  topDoctors: Array<{ doctor: string; doctorId: string; visits: number }>;
  vitals: { waiting: number; recordedToday: number } | null;
  doctor: { myWaiting: number; mySeenToday: number } | null;
  pendingApprovals: number | null;
};
