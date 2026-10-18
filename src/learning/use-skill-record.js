import { useCallback, useEffect, useRef, useState } from 'react';
import { SKILLS_STORE_KEY, emptySkills, normalizeSkills, createPracticeEvidence, addPracticeEvidence } from './skill-records.mjs';

export function useSkillRecord({ storage, origin, lesson, task, formula, feedback, workspaceHydrated, onExternal }) {
  const [record, setRecord] = useState(emptySkills);
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [reloadSerial, setReloadSerial] = useState(0);
  const current = useRef(record), epoch = useRef(0), chain = useRef(Promise.resolve()), latestWrite = useRef(0);
  const missing = useRef(false), imported = useRef(false), external = useRef(onExternal);
  const writable = useRef(false);
  external.current = onExternal;

  useEffect(() => {
    let active = true;
    const serial = ++epoch.current;
    writable.current = false;
    setAvailable(false);
    Promise.resolve().then(() => storage.get(SKILLS_STORE_KEY)).then(value => {
      if (!active || epoch.current !== serial) return;
      missing.current = value == null; imported.current = false;
      const restored = normalizeSkills(value);
      current.current = restored; writable.current = true; setRecord(restored); setAvailable(true); setNotice('');
    }).catch(error => { if (active) setNotice(`${error.message || 'Could not read the local skill record.'} Saved records have not been replaced.`); });
    return () => { active = false; writable.current = false; epoch.current += 1; };
  }, [storage, reloadSerial]);

  useEffect(() => storage.subscribe?.(() => {
    epoch.current += 1; writable.current = false; external.current?.();
    setReloadSerial(value => value + 1);
  }), [storage]);

  const mutate = useCallback(reducer => {
    if (!writable.current) return Promise.resolve(false);
    const value = normalizeSkills(reducer(current.current)), serial = epoch.current, writeId = ++latestWrite.current;
    current.current = value; setRecord(value); setPending(true);
    const operation = chain.current.catch(() => {}).then(async () => {
      if (epoch.current !== serial) return false;
      await storage.set(SKILLS_STORE_KEY, value);
      return true;
    }).catch(error => {
      if (epoch.current === serial) {
        epoch.current += 1; writable.current = false;
        setNotice(`${error.message || 'Could not save the skill record.'} Your lesson and answer draft are kept. Retry local storage before another edit.`);
        setAvailable(false);
      }
      return false;
    }).finally(() => { if (writeId === latestWrite.current) setPending(false); });
    chain.current = operation;
    return operation;
  }, [available, storage]);

  // Import only an exact old backend result, once when no skill record exists.
  // Clearing creates an explicit empty record, so reload cannot undo that clear.
  useEffect(() => {
    if (!available || !workspaceHydrated || imported.current) return;
    imported.current = true;
    if (!missing.current) return;
    const evidence = createPracticeEvidence({ lesson, task, formula, feedback, origin });
    if (evidence) void mutate(value => addPracticeEvidence(value, evidence));
  }, [available, workspaceHydrated, lesson, task, formula, feedback, origin, mutate]);

  return { record, available, pending, notice, mutate, reload: () => setReloadSerial(value => value + 1) };
}
