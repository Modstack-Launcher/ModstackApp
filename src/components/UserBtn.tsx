import { useState } from "react";
import { useAuth, userKey } from "../stores/authContext";
import {
  Dropdown,
  Modal,
  Button,
  TextField,
  Label,
  Input,
  useOverlayState,
  Tooltip,
  Separator,
} from "@heroui/react";
import { IconLogout, IconShoppingCart, IconUserPlus, IconX } from "@tabler/icons-react";
import Ms from "./icons/Ms";
import { open } from "@tauri-apps/plugin-shell";

export default function UserBtn() {
  const {
    authReady,
    user,
    loginWithMicrosoft,
    loginWithMojang,
    userList,
    selectUser,
    removeUser,
    logout,
  } = useAuth();

  const modalState = useOverlayState();
  const [offlineUsername, setOfflineUsername] = useState("");
  const [loginMode, setLoginMode] = useState<"microsoft" | "offline" | null>(null);

  const skinHelmURL = (name: string) =>
    `https://mineskin.eu/helm/${name}/40.png`;

  const getUserType = (u: User) =>
    u.type === "microsoft" ? "Microsoft" : "Offline";

  const handleAddMicrosoft = async () => {
    setLoginMode("microsoft");
    modalState.open();
    try {
      await loginWithMicrosoft();
    } catch (e) {
      console.error("Login Microsoft failed", e);
    } finally {
      modalState.close();
      setLoginMode(null);
    }
  };

  const handleAddOffline = () => {
    setLoginMode("offline");
    modalState.open();
  };

  const handleOfflineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginWithMojang(offlineUsername)
      .then(() => {
        modalState.close();
        setOfflineUsername("");
        setLoginMode(null);
      })
      .catch(console.error);
  };

  const handleOfflineCancel = () => {
    modalState.close();
    setOfflineUsername("");
    setLoginMode(null);
  };

  if (!authReady) return null;

  return (
    <>
      <Dropdown>
        <Tooltip delay={0}>
          <Button variant="tertiary" size="lg" isIconOnly className="p-1">
            <img
              src={
                user?.minecraft?.name
                  ? skinHelmURL(user.minecraft.name)
                  : "./steve-helm.png"
              }
              alt={user?.minecraft?.name || "Steve"}
              className="size-full rounded"
            />
          </Button>
          <Tooltip.Content placement="right" offset={8} className="text-sm font-semibold">
            <p>{user?.minecraft?.name || "Not logged in"}</p>
          </Tooltip.Content>
        </Tooltip>

        <Dropdown.Popover className="min-w-64">
          <Dropdown.Menu>
            {userList.length > 0 && (
              <>
                <Dropdown.Section>
                  {userList.map((u) => (
                    <Dropdown.Item
                      key={u.minecraft.uuid}
                      id={u.minecraft.uuid}
                      textValue={u.minecraft.name}
                      onPress={() => selectUser(u)}
                    >
                      <div className="flex items-center gap-2 w-full min-w-0">
                        <img
                          src={skinHelmURL(u.minecraft.name)}
                          alt={u.minecraft.name}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = "./steve-helm.png";
                          }}
                          className="size-6 rounded shrink-0"
                        />
                        <div className="flex-1 flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate">{u.minecraft.name}</span>
                          <span className="text-xs text-muted">{getUserType(u)}</span>
                        </div>
                        {user && userKey(user) === userKey(u) && (
                          <span className="size-1.5 rounded-full bg-success shrink-0" />
                        )}
                        <div
                          onPointerDown={(e) => e.stopPropagation()}
                          onPointerUp={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            isIconOnly
                            onPress={() => removeUser(u)}
                            className="size-5 rounded opacity-40 hover:opacity-100"
                            aria-label={`Remove ${u.minecraft.name}`}
                          >
                            <IconX size={10} />
                          </Button>
                        </div>
                      </div>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Section>
                <Separator />
              </>
            )}

            <Dropdown.Item id="add-microsoft" textValue="Add Microsoft account" onPress={handleAddMicrosoft}>
              <div className="flex items-center gap-2">
                <Ms className="w-4 h-4" />
                <span>{userList.length === 0 ? "Sign in with Microsoft" : "Add Microsoft account"}</span>
              </div>
            </Dropdown.Item>

            <Dropdown.Item id="add-offline" textValue="Add offline account" onPress={handleAddOffline}>
              <div className="flex items-center gap-2">
                <IconUserPlus className="w-4 h-4" />
                <span>{userList.length === 0 ? "Play offline" : "Add offline account"}</span>
              </div>
            </Dropdown.Item>

            {user && (
              <>
                <Separator />
                <Dropdown.Item
                  id="sign-out"
                  variant="danger"
                  className="data-[hover=true]:bg-danger/40"
                  onPress={logout}
                >
                  <div className="flex items-center gap-2">
                    <IconLogout className="w-4 h-4" />
                    <span>Sign out</span>
                  </div>
                </Dropdown.Item>
              </>
            )}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <Modal.Backdrop
        isDismissable={false}
        isKeyboardDismissDisabled={loginMode === "microsoft"}
        isOpen={modalState.isOpen}
        onOpenChange={modalState.setOpen}
      >
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>
                {loginMode === "microsoft" ? "Signing in..." : "Add offline account"}
              </Modal.Heading>
            </Modal.Header>

            <Modal.Body className="p-2 gap-4">
              {loginMode === "microsoft" ? (
                <p className="text-center text-sm text-muted">Please wait...</p>
              ) : (
                <form
                  onSubmit={handleOfflineSubmit}
                  onReset={handleOfflineCancel}
                  className="flex flex-col gap-4"
                >
                  <TextField
                    variant="secondary"
                    name="username"
                    isRequired
                    value={offlineUsername}
                    onChange={(val) => setOfflineUsername(val.replace(/[^a-zA-Z0-9_]/g, ""))}
                    autoFocus
                  >
                    <Label>Username</Label>
                    <Input
                      placeholder="Between 3 and 16 characters"
                      minLength={3}
                      maxLength={16}
                    />
                  </TextField>

                  <div className="flex gap-2 justify-end">
                    <Button type="reset" variant="secondary" size="sm" fullWidth>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      fullWidth
                      isDisabled={offlineUsername.length < 3 || offlineUsername.length > 16}
                    >
                      Confirm
                    </Button>
                  </div>

                  <hr className="border-border/40" />

                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    onPress={() => open("https://www.minecraft.net/en-us/choose-your-game")}
                    className="text-blue-400 border-blue-900 bg-blue-950/40 hover:bg-blue-900/40"
                  >
                    <IconShoppingCart className="w-4 h-4" />
                    Buy Minecraft
                  </Button>
                </form>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
