自动构建发布 v1.0.7

```bash
docker pull mobufan/fan-webssh:latest
```
```bash
docker pull mobufan/fan-webssh:v1.0.7
```

```bash
docker pull ghcr.io/meimolihan/fan-webssh:latest
```
```bash
docker pull ghcr.io/meimolihan/fan-webssh:v1.0.7
```

## 二进制安装
```bash
bash -c "$(curl -sSL https://raw.githubusercontent.com/meimolihan/fan-webssh/main/scripts/install.sh)" -p 8082 -d /var/lib/fan-webssh
```

## 二进制卸载
```bash
bash -c "$(curl -sSL https://raw.githubusercontent.com/meimolihan/fan-webssh/main/scripts/uninstall.sh)" -y --purge
```
