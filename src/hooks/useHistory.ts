import { useState, useCallback } from 'react';

export function useHistory<T>(initialState: T) {
    const [state, setStateInternal] = useState<T>(initialState);
    const [past, setPast] = useState<T[]>([]);
    const [future, setFuture] = useState<T[]>([]);

    const setState = useCallback((newState: T | ((prev: T) => T)) => {
        setStateInternal((currentState) => {
            const nextState = newState instanceof Function ? newState(currentState) : newState;
            if (nextState === currentState) return currentState;

            setPast((prev) => [...prev, currentState]);
            setFuture([]); // Clear redo stack on new change
            return nextState;
        });
    }, []);

    const undo = useCallback(() => {
        setPast((prev) => {
            if (prev.length === 0) return prev;
            const newPast = [...prev];
            const previousState = newPast.pop()!;

            setFuture((prevFuture) => [state, ...prevFuture]);
            setStateInternal(previousState);

            return newPast;
        });
    }, [state]);

    const redo = useCallback(() => {
        setFuture((prev) => {
            if (prev.length === 0) return prev;
            const newFuture = [...prev];
            const nextState = newFuture.shift()!;

            setPast((prevPast) => [...prevPast, state]);
            setStateInternal(nextState);

            return newFuture;
        });
    }, [state]);

    const canUndo = past.length > 0;
    const canRedo = future.length > 0;

    return { state, setState, undo, redo, canUndo, canRedo, past, future };
}
