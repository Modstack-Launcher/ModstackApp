import { useNavigation } from "../hooks/useNavigation";
import { Button, Tooltip } from "@heroui/react";
import {
  IconHome,
  IconHomeFilled,
  IconSettings,
  IconSettingsFilled,
  IconShirt,
  IconShirtFilled,
  IconBox,
} from "@tabler/icons-react";
import { Pickaxe, Server } from "lucide-react";
import UserBtn from "./UserBtn";
import { useInstance } from "../stores/instanceContext";
import { loadLocalInstances } from "../utils/localInstances";
import { useEffect, useState } from "react";
import { LoaderIcon } from "./icons/LoaderIcon";

function NavButton({
  path,
  label,
  children,
}: {
  path: string;
  label: string;
  children: React.ReactNode | ((active: boolean) => React.ReactNode);
}) {
  const push = useNavigation((state) => state.push);
  const currentPath = useNavigation((state) => state.currentPath);

  return (
    <Tooltip delay={0}>
      <Button
        variant="tertiary"
        size="lg"
        isIconOnly
        className="data-[active=true]:bg-accent data-[active=true]:text-accent-foreground hover:data-[active=true]:bg-accent-hover"
        onPress={() => push(path)}
        data-active={currentPath === path}
      >
        {typeof children === "function"
          ? children(currentPath === path)
          : children}
      </Button>
      <Tooltip.Content
        placement="right"
        offset={8}
        className="text-sm font-semibold"
      >
        <p>{label}</p>
      </Tooltip.Content>
    </Tooltip>
  );
}

function InstanceButton({
  instance,
  localIds,
}: {
  instance: Instance;
  localIds: Set<string>;
}) {
  const { selectedInstance, setSelectedInstance } = useInstance();
  const push = useNavigation((state) => state.push);
  const currentPath = useNavigation((state) => state.currentPath);
  const [imgError, setImgError] = useState(false);

  const isSelected =
    selectedInstance?.id === instance.id &&
    (localIds.has(instance.id)
      ? currentPath === "instances"
      : currentPath === "home");

  const handlePress = () => {
    if (localIds.has(instance.id)) {
      setSelectedInstance(instance);
      push("instances");
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("open-local-instance", { detail: { id: instance.id } })
        );
      }, 50);
    } else {
      setSelectedInstance(instance);
      push("home");
    }
  };

  const loader = (instance as any).loader as string | undefined;

  return (
    <Tooltip delay={0}>
      <Button
        variant="tertiary"
        size="lg"
        isIconOnly
        className="data-[active=true]:ring-2 data-[active=true]:ring-accent data-[active=true]:ring-offset-1 data-[active=true]:ring-offset-surface"
        data-active={isSelected}
        onPress={handlePress}
      >
        {!imgError && instance.icon ? (
          <img
            src={instance.icon}
            alt={instance.title}
            className="size-8 rounded"
            onError={() => setImgError(true)}
          />
        ) : loader ? (
          <LoaderIcon loader={loader} size={32} />
        ) : (
          <IconBox className="size-6" />
        )}
      </Button>
      <Tooltip.Content
        placement="right"
        offset={8}
        className="text-sm font-semibold"
      >
        <p>{instance.title || instance.id}</p>
      </Tooltip.Content>
    </Tooltip>
  );
}

export default function NavBar() {
  const { instances } = useInstance();
  const [localIds, setLocalIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadLocalInstances()
      .then((list) => setLocalIds(new Set(list.map((l) => l.id))))
      .catch(() => {});

    const handler = () => {
      loadLocalInstances()
        .then((list) => setLocalIds(new Set(list.map((l) => l.id))))
        .catch(() => {});
    };
    window.addEventListener("open-local-instance", handler);
    return () => window.removeEventListener("open-local-instance", handler);
  }, []);

  return (
    <div className="h-full p-4 bg-surface flex flex-col justify-between">
      <div className="flex flex-col gap-y-2">
        <NavButton path="home" label="Home">
          {(active) =>
            active ? (
              <IconHomeFilled className="size-6" />
            ) : (
              <IconHome className="size-6" />
            )
          }
        </NavButton>
        <NavButton path="bedrock" label="Bedrock">
          <Pickaxe className="size-6" />
        </NavButton>
        <NavButton path="instances" label="Instances">
          <IconBox className="size-6" />
        </NavButton>
        <NavButton path="server_browser" label="Server Browser">
          <Server className="size-6" />
        </NavButton>
        <NavButton path="skins" label="Skins">
          {(active) =>
            active ? (
              <IconShirtFilled className="size-6" />
            ) : (
              <IconShirt className="size-6" />
            )
          }
        </NavButton>
        {instances.length > 0 && (
          <div className="w-full h-px bg-white/10 my-1" />
        )}
        {instances.slice(0, 4).map((instance) => (
          <InstanceButton
            key={instance.id}
            instance={instance}
            localIds={localIds}
          />
        ))}
      </div>

      <div className="flex flex-col gap-y-2">
        <NavButton path="settings" label="Settings">
          {(active) =>
            active ? (
              <IconSettingsFilled className="size-6" />
            ) : (
              <IconSettings className="size-6" />
            )
          }
        </NavButton>
        <UserBtn />
      </div>
    </div>
  );
}