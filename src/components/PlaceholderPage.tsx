import { useWizardStore } from "@/stores/wizard-store";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CircleAlert } from "lucide-react";

interface PlaceholderPageProps {
  title: string;
  description: string;
}

export default function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  const { prevStep } = useWizardStore();

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto w-full">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-5">
            <CircleAlert className="w-7 h-7 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-1.5">{title}</h2>
          <p className="text-[14px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex justify-start pt-5 border-t border-border">
        <Button variant="ghost" size="default" onClick={prevStep}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          上一步
        </Button>
      </div>
    </div>
  );
}
