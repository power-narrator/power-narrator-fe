export type ActionButtonState = {
  loading: boolean;
  /** No action can be taken: another operation holds the viewer, or there is nothing to act on. */
  unavailable: boolean;
  status: string;
};
