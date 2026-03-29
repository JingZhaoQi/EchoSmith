import { useEffect, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { fetchHotwords, addHotword, removeHotword } from "../lib/api";

export function HotwordSettings(): JSX.Element {
  const [words, setWords] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchHotwords().then(setWords).catch(console.error);
  }, []);

  const handleAdd = async () => {
    const word = input.trim();
    if (!word) return;
    setLoading(true);
    try {
      const updated = await addHotword(word);
      setWords(updated);
      setInput("");
    } catch (error) {
      console.error("添加热词失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (word: string) => {
    try {
      const updated = await removeHotword(word);
      setWords(updated);
    } catch (error) {
      console.error("删除热词失败:", error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">热词表</h3>
      <p className="text-xs text-muted-foreground">
        添加专业术语、人名等，纠错时优先使用这些词汇
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          placeholder="输入热词…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <Button
          variant="secondary"
          size="sm"
          className="gap-1"
          disabled={!input.trim() || loading}
          onClick={handleAdd}
        >
          <PlusIcon className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {words.map((word) => (
          <span
            key={word}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs"
          >
            {word}
            <button
              className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20 transition-colors"
              onClick={() => handleRemove(word)}
            >
              <XIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
        {words.length === 0 && (
          <span className="text-xs text-muted-foreground">暂无热词</span>
        )}
      </div>
    </Card>
  );
}
