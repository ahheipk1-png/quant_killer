using System;

namespace QuantKiller.Core;

/// <summary>Raised for invalid pricing inputs. The CLI maps this to {"ok": false, ...}.</summary>
public class QkException : ArgumentException
{
    public QkException(string message) : base(message) { }
}
