import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DerivedTask, Metrics, Task } from '@/types';
import {
  computeAverageROI,
  computePerformanceGrade,
  computeRevenuePerHour,
  computeTimeEfficiency,
  computeTotalRevenue,
  withDerived,
  sortTasks as sortDerived,
} from '@/utils/logic';
import { generateSalesTasks } from '@/utils/seed';

interface UseTasksState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  derivedSorted: DerivedTask[];
  metrics: Metrics;
  lastDeleted: Task | null;
  addTask: (task: Omit<Task, 'id'> & { id?: string }) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  undoDelete: () => void;
}

const INITIAL_METRICS: Metrics = {
  totalRevenue: 0,
  totalTimeTaken: 0,
  timeEfficiencyPct: 0,
  revenuePerHour: 0,
  averageROI: 0,
  performanceGrade: 'Needs Improvement',
};

export function useTasks(): UseTasksState {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastDeleted, setLastDeleted] = useState<Task | null>(null);
  const fetchedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null); // ADD for cleanup

  function normalizeTasks(input: any[]): Task[] {
    const now = Date.now();
    return (Array.isArray(input) ? input : []).map((t, idx) => {
      const created = t.createdAt ? new Date(t.createdAt) : new Date(now - (idx + 1) * 24 * 3600 * 1000);
      const completed = t.completedAt || (t.status === 'Done' ? new Date(created.getTime() + 24 * 3600 * 1000).toISOString() : undefined);
      return {
        id: t.id,
        title: t.title,
        revenue: Number(t.revenue) ?? 0,
        timeTaken: Number(t.timeTaken) > 0 ? Number(t.timeTaken) : 1,
        priority: t.priority,
        status: t.status,
        notes: t.notes,
        createdAt: created.toISOString(),
        completedAt: completed,
      } as Task;
    });
  }

  // ✅ FIXED: Single useEffect for initial load
  useEffect(() => {
    // Skip if already fetched
    if (fetchedRef.current) {
      setLoading(false);
      return;
    }

    let isMounted = true;
    
    // Create abort controller for cleanup
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    async function load() {
      try {
        console.log('📥 Fetching tasks (should happen once)...');
        
        const res = await fetch('/tasks.json', { signal });
        if (!res.ok) throw new Error(`Failed to load tasks.json (${res.status})`);
        
        const data = (await res.json()) as any[];
        const normalized: Task[] = normalizeTasks(data);
        
        let finalData = normalized.length > 0 ? normalized : generateSalesTasks(50);
        
        // 🐛 BUG 5: Remove the injected malformed rows - they cause ROI errors
        // Instead, validate and filter invalid tasks
        finalData = finalData.filter(task => {
          // Validate each task
          const isValid = 
            task.id && 
            task.title && 
            !isNaN(Number(task.revenue)) && 
            Number(task.timeTaken) > 0;
          
          if (!isValid) {
            console.warn('Filtered invalid task:', task);
          }
          return isValid;
        });

        if (isMounted) {
          setTasks(finalData);
          fetchedRef.current = true;
          console.log(`✅ Loaded ${finalData.length} valid tasks`);
        }
      } catch (e: any) {
        // Only set error if not aborted
        if (e.name !== 'AbortError' && isMounted) {
          console.error('❌ Error loading tasks:', e);
          setError(e?.message ?? 'Failed to load tasks');
          // Fallback to generated tasks on error
          setTasks(generateSalesTasks(50));
          fetchedRef.current = true;
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }
    
    load();
    
    // Cleanup function
    return () => {
      isMounted = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []); // Empty dependency array = run once

  // ❌ REMOVED: The second useEffect that causes duplicate fetches
  // This was the injected bug causing BUG 1

  const derivedSorted = useMemo<DerivedTask[]>(() => {
    const withRoi = tasks.map(withDerived);
    return sortDerived(withRoi);
  }, [tasks]);

  const metrics = useMemo<Metrics>(() => {
    if (tasks.length === 0) return INITIAL_METRICS;
    const totalRevenue = computeTotalRevenue(tasks);
    const totalTimeTaken = tasks.reduce((s, t) => s + t.timeTaken, 0);
    const timeEfficiencyPct = computeTimeEfficiency(tasks);
    const revenuePerHour = computeRevenuePerHour(tasks);
    const averageROI = computeAverageROI(tasks);
    const performanceGrade = computePerformanceGrade(averageROI);
    return { totalRevenue, totalTimeTaken, timeEfficiencyPct, revenuePerHour, averageROI, performanceGrade };
  }, [tasks]);

  // 🐛 BUG 5: Improved addTask with validation
  const addTask = useCallback((task: Omit<Task, 'id'> & { id?: string }) => {
    // Validate inputs before adding
    if (!task.title?.trim()) {
      throw new Error('Task title is required');
    }
    
    if (isNaN(Number(task.revenue)) || Number(task.revenue) < 0) {
      throw new Error('Revenue must be a valid positive number');
    }
    
    // Ensure timeTaken is valid
    const timeTaken = Number(task.timeTaken);
    const safeTimeTaken = timeTaken > 0 ? timeTaken : 1;
    
    setTasks(prev => {
      const id = task.id ?? crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const status = task.status;
      const completedAt = status === 'Done' ? createdAt : undefined;
      
      return [...prev, { 
        ...task, 
        id, 
        timeTaken: safeTimeTaken, 
        createdAt, 
        completedAt,
        revenue: Number(task.revenue) // Ensure it's a number
      }];
    });
  }, []);

  // 🐛 BUG 5: Improved updateTask with validation
  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks(prev => {
      const next = prev.map(t => {
        if (t.id !== id) return t;
        
        const merged = { ...t, ...patch } as Task;
        
        // Validate revenue if being updated
        if (patch.revenue !== undefined && (isNaN(Number(patch.revenue)) || Number(patch.revenue) < 0)) {
          console.warn('Invalid revenue update, keeping original');
          merged.revenue = t.revenue;
        }
        
        // Validate timeTaken if being updated
        if (patch.timeTaken !== undefined) {
          const newTime = Number(patch.timeTaken);
          merged.timeTaken = newTime > 0 ? newTime : t.timeTaken;
        }
        
        if (t.status !== 'Done' && merged.status === 'Done' && !merged.completedAt) {
          merged.completedAt = new Date().toISOString();
        }
        
        return merged;
      });
      
      return next;
    });
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks(prev => {
      const target = prev.find(t => t.id === id) || null;
      setLastDeleted(target);
      return prev.filter(t => t.id !== id);
    });
  }, []);

  const undoDelete = useCallback(() => {
    if (!lastDeleted) return;
    setTasks(prev => [...prev, lastDeleted]);
    setLastDeleted(null);
  }, [lastDeleted]);

  // 🐛 BUG 2: Add cleanup for lastDeleted (for snackbar)
  // This should be called when snackbar closes
  const clearLastDeleted = useCallback(() => {
    setLastDeleted(null);
  }, []);

  return { 
    tasks, 
    loading, 
    error, 
    derivedSorted, 
    metrics, 
    lastDeleted, 
    addTask, 
    updateTask, 
    deleteTask, 
    undoDelete,
    clearLastDeleted // ADD this for snackbar cleanup
  };
}
