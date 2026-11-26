import { Component, type ReactNode } from 'react';

/** A survey that fails to load or render must not leave the waiter session on a dead screen: lock instead. */
export class SurveyBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch() {
        this.props.onFail();
    }
    render() {
        return this.state.failed ? null : this.props.children;
    }
}
